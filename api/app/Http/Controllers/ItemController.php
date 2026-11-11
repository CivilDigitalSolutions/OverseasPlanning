<?php

namespace App\Http\Controllers;

use App\Services\Membership;
use App\Services\Notifier;
use App\Services\TripAccess;
use App\Support\Clean;
use App\Support\ItemSchemas;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Flights, hotels, hire cars, assets (firestore.rules `/{coll}/{itemId}` + functions
 * onFlightWritten). Any member edits; only an SPC records a flight decision; ANY ordinary edit of a
 * flight clears its decision so a changed flight must be approved again.
 */
class ItemController extends Controller
{
    private const SPC_KEYS = ['spcDecision', 'spcRationale', 'spcDecidedBy', 'spcDecidedByName', 'spcDecidedAt'];

    public static function view(object $i): array
    {
        $values = json_decode($i->values, true) ?: [];
        if ($i->spc_decision) {
            $values += [
                'spcDecision' => $i->spc_decision, 'spcRationale' => $i->spc_rationale, 'spcDecidedBy' => $i->spc_decided_by,
                'spcDecidedByName' => $i->spc_decided_by_name, 'spcDecidedAtMs' => self::ms($i->spc_decided_at),
            ];
        }
        return ['id' => $i->id, 'values' => $values, 'createdByName' => $i->created_by_name, 'updatedAtMs' => self::ms($i->updated_at ?? $i->created_at)];
    }

    private function kind(string $kind): string
    {
        abort_unless(in_array($kind, ItemSchemas::KINDS, true), 404);
        return $kind;
    }

    public function index(Request $request, string $trip, string $kind): JsonResponse
    {
        $t = TripAccess::needView($this->me($request), $trip);
        $rows = DB::table('trip_items')->where('trip_id', $t->id)->where('kind', $this->kind($kind))->orderBy('created_at')->get();
        return response()->json(['items' => $rows->map(fn ($i) => self::view($i))]);
    }

    public function store(Request $request, string $trip, string $kind): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $kind = $this->kind($kind);
        [$values, $errors] = ItemSchemas::check($kind, $request->input('values'));
        if ($errors) {
            return response()->json(['message' => 'Check the highlighted fields.', 'errors' => $errors], 422);
        }
        if (DB::table('trip_items')->where('trip_id', $t->id)->count() >= 2000) {
            return $this->fail(429, 'This trip has too many bookings.');
        }
        $id = (string) Str::ulid();
        DB::table('trip_items')->insert([
            'id' => $id, 'trip_id' => $t->id, 'kind' => $kind, 'values' => json_encode($values), 'created_by' => $u->id,
            'created_by_name' => self::nameOf($u), 'updated_by' => $u->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        if ($kind === 'flights') {
            $this->afterFlightWrite($t, [], $values, $u->id);
        }
        return response()->json(['id' => $id], 201);
    }

    public function update(Request $request, string $trip, string $kind, string $id): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $kind = $this->kind($kind);
        $item = $this->find($t->id, $kind, $id);
        $raw = $request->input('values');
        if (is_array($raw)) {
            $raw = array_diff_key($raw, array_flip([...self::SPC_KEYS, 'spcDecidedAtMs']));
        }
        [$values, $errors] = ItemSchemas::check($kind, $raw);
        if ($errors) {
            return response()->json(['message' => 'Check the highlighted fields.', 'errors' => $errors], 422);
        }
        // An ordinary edit always leaves the item WITHOUT an SPC decision (it must be approved again).
        DB::table('trip_items')->where('id', $item->id)->update([
            'values' => json_encode($values), 'updated_by' => $u->id, 'updated_at' => now(),
            'spc_decision' => null, 'spc_rationale' => null, 'spc_decided_by' => null, 'spc_decided_by_name' => null, 'spc_decided_at' => null,
        ]);
        if ($kind === 'flights') {
            $this->afterFlightWrite($t, json_decode($item->values, true) ?: [], $values, $u->id);
        }
        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, string $trip, string $kind, string $id): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $kind = $this->kind($kind);
        $item = $this->find($t->id, $kind, $id);
        DB::table('trip_items')->where('id', $item->id)->delete();
        if ($kind === 'flights') {
            $this->afterFlightWrite($t, json_decode($item->values, true) ?: [], [], $u->id);
        }
        return response()->json(['ok' => true]);
    }

    /** The SPC approves (or not) a flight, with a written rationale, touching nothing else. */
    public function decide(Request $request, string $trip, string $id): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        TripAccess::needSpc($u, $t);
        $item = $this->find($t->id, 'flights', $id);
        $decision = $request->input('decision');
        $rationale = Clean::text($request->input('rationale'), 2000);
        if (!in_array($decision, ['approved', 'not_approved'], true) || $rationale === '') {
            return $this->fail(422, 'Choose a decision and give a rationale.');
        }
        DB::table('trip_items')->where('id', $item->id)->update([
            'spc_decision' => $decision, 'spc_rationale' => $rationale, 'spc_decided_by' => $u->id,
            'spc_decided_by_name' => self::nameOf($u), 'spc_decided_at' => now(), 'updated_at' => now(),
        ]);
        return response()->json(['ok' => true]);
    }

    private function find(string $tripId, string $kind, string $id): object
    {
        $item = Clean::isId($id) ? DB::table('trip_items')->where('id', $id)->where('trip_id', $tripId)->where('kind', $kind)->first() : null;
        abort_unless($item, 404, 'Not found.');
        return $item;
    }

    /** Booking someone on a flight (or taking them off) changes who is on the trip. */
    private function afterFlightWrite(object $trip, array $before, array $after, string $actor): void
    {
        $uids = fn (array $v) => array_values(array_unique(array_filter(array_map(fn ($p) => $p['uid'] ?? null, $v['passengers'] ?? []))));
        $b = $uids($before);
        $a = $uids($after);
        sort($b);
        sort($a);
        if ($a === $b) {
            return;
        }
        $booked = array_values(array_diff($a, $b));
        // "Booked on a flight" also covers being added to the trip by it: one notification, not two.
        Membership::recompute($trip->id, $actor, $booked);
        $tell = Notifier::recipients($booked, $actor);
        if ($tell) {
            $route = implode(' → ', array_filter([$after['from'] ?? '', $after['to'] ?? '']));
            $when = isset($after['departAt']) ? ', ' . str_replace('T', ' ', $after['departAt']) : '';
            Notifier::send($tell, 'flight_added', 'Booked on a flight', Membership::flightLabel($after) . ($route ? " {$route}" : '') . "{$when} — {$trip->name}.", $trip->id, "/trips/{$trip->id}/flights");
        }
    }
}
