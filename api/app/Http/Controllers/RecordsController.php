<?php

namespace App\Http\Controllers;

use App\Services\TripAccess;
use App\Support\Clean;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The rest of a trip's tabs: requests to the Team Leader (SPC approval), summaries, vaccination
 * declarations, debrief, financial debrief, trip contacts, and the whole-trip export.
 * Each method mirrors the matching block in firestore.rules.
 */
class RecordsController extends Controller
{
    // ---- requests (decided by an SPC; approval is final) -------------------------------------------

    public static function tlView(object $r): array
    {
        return [
            'id' => $r->id, 'kind' => $r->kind, 'title' => $r->title, 'details' => $r->details, 'quantity' => $r->quantity === null ? null : (int) $r->quantity,
            'amount' => $r->amount === null ? null : (float) $r->amount, 'currency' => $r->currency, 'neededBy' => $r->needed_by, 'createdBy' => $r->created_by,
            'createdByName' => $r->created_by_name, 'createdAtMs' => self::ms($r->created_at), 'status' => $r->status, 'decidedByName' => $r->decided_by_name ?? '',
            'decidedAtMs' => self::ms($r->decided_at), 'decisionNote' => $r->decision_note ?? '',
        ];
    }

    public function tlIndex(Request $request, string $trip): JsonResponse
    {
        $t = TripAccess::needView($this->me($request), $trip);
        return response()->json(['requests' => DB::table('tl_requests')->where('trip_id', $t->id)->get()->map(fn ($r) => self::tlView($r))]);
    }

    public function tlStore(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $kind = $request->input('kind');
        $title = Clean::text($request->input('title'), 120);
        $qty = $request->input('quantity');
        $amount = $request->input('amount');
        $currency = Clean::text($request->input('currency'), 10);
        $neededBy = (string) $request->input('neededBy', '');
        if (!in_array($kind, Clean::REQUEST_KINDS, true) || $title === '') {
            return $this->fail(422, 'Choose a type and enter a title.');
        }
        if ($qty !== null && (!is_int($qty) || $qty < 1 || $qty > 1000)) {
            return $this->fail(422, 'Enter a quantity from 1 to 1000.');
        }
        if ($amount !== null && (!(is_int($amount) || is_float($amount)) || $amount <= 0 || $amount > 1_000_000 || $currency === '')) {
            return $this->fail(422, 'Enter an amount and currency.');
        }
        if ($neededBy !== '' && !Clean::isDate($neededBy)) {
            return $this->fail(422, 'Enter a valid date.');
        }
        $id = (string) Str::ulid();
        DB::table('tl_requests')->insert([
            'id' => $id, 'trip_id' => $t->id, 'kind' => $kind, 'title' => $title, 'details' => Clean::text($request->input('details'), 2000),
            'quantity' => $qty, 'amount' => $amount, 'currency' => $amount !== null ? $currency : '', 'needed_by' => $neededBy, 'status' => 'pending',
            'created_by' => $u->id, 'created_by_name' => self::nameOf($u), 'created_at' => now(), 'updated_at' => now(),
        ]);
        return response()->json(['id' => $id], 201);
    }

    public function tlDecide(Request $request, string $trip, string $id): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        TripAccess::needSpc($u, $t);
        $approve = $request->boolean('approve');
        $n = $this->tlQuery($t->id, $id)->where('status', 'pending')->update([
            'status' => $approve ? 'approved' : 'rejected', 'decided_by' => $u->id, 'decided_by_name' => self::nameOf($u),
            'decided_at' => now(), 'decision_note' => Clean::text($request->input('note'), 1000), 'updated_at' => now(),
        ]);
        return $n ? response()->json(['ok' => true]) : $this->fail(409, 'This request has already been decided.');
    }

    /** Only the creator, and only after a rejection, sends a request back for a fresh decision. */
    public function tlResubmit(Request $request, string $trip, string $id): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $n = $this->tlQuery($t->id, $id)->where('status', 'rejected')->where('created_by', $u->id)->update([
            'status' => 'pending', 'decided_by' => null, 'decided_by_name' => null, 'decided_at' => null, 'decision_note' => null, 'updated_at' => now(),
        ]);
        return $n ? response()->json(['ok' => true]) : $this->fail(403, "You can't resubmit this request.");
    }

    /** The creator withdraws a pending request; an SPC may delete any. */
    public function tlDestroy(Request $request, string $trip, string $id): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $q = $this->tlQuery($t->id, $id);
        if (!TripAccess::isSpc($u, $t)) {
            $q->where('created_by', $u->id)->where('status', 'pending');
        }
        return $q->delete() ? response()->json(['ok' => true]) : $this->fail(403, "You can't delete this request.");
    }

    private function tlQuery(string $tripId, string $id): \Illuminate\Database\Query\Builder
    {
        abort_unless(Clean::isId($id), 404);
        return DB::table('tl_requests')->where('trip_id', $tripId)->where('id', $id);
    }

    // ---- summaries (anyone on the trip) -------------------------------------------------------------

    public function summaries(Request $request, string $trip): JsonResponse
    {
        $t = TripAccess::needView($this->me($request), $trip);
        $out = ['teamLeader' => null, 'spc' => null];
        foreach (DB::table('summaries')->where('trip_id', $t->id)->get() as $s) {
            $out[$s->role] = ['text' => $s->text, 'byName' => $s->by_name, 'updatedAtMs' => self::ms($s->updated_at)];
        }
        return response()->json(['summaries' => $out]);
    }

    public function saveSummary(Request $request, string $trip, string $role): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        abort_unless(in_array($role, ['teamLeader', 'spc'], true), 404);
        DB::table('summaries')->upsert([[
            'trip_id' => $t->id, 'role' => $role, 'text' => Clean::text($request->input('text'), 5000), 'by_user_id' => $u->id, 'by_name' => self::nameOf($u), 'updated_at' => now(),
        ]], ['trip_id', 'role'], ['text', 'by_user_id', 'by_name', 'updated_at']);
        return response()->json(['ok' => true]);
    }

    // ---- vaccination declarations (health data; encrypted) -----------------------------------------

    public static function vaccView(object $v): array
    {
        return [
            'uid' => $v->user_id, 'name' => $v->name, 'vaccines' => json_decode(Crypt::decryptString($v->vaccines_enc), true) ?: [],
            'notes' => Crypt::decryptString($v->notes_enc), 'declared' => (bool) $v->declared, 'declaredAtMs' => self::ms($v->declared_at),
        ];
    }

    /** Your own; the Team Leader and HOST read all. */
    public function vaccinations(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $q = DB::table('vaccinations')->where('trip_id', $t->id);
        if (!($request->boolean('all') && TripAccess::isLead($u, $t))) {
            $q->where('user_id', $u->id);
        }
        return response()->json(['vaccinations' => $q->get()->map(fn ($v) => self::vaccView($v))]);
    }

    public function saveVaccination(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $list = $request->input('vaccines', []);
        if (!is_array($list) || !array_is_list($list) || count($list) > 30) {
            return $this->fail(422, 'At most 30 vaccinations.');
        }
        $vaccines = [];
        foreach ($list as $x) {
            $name = Clean::text($x['name'] ?? '', 80);
            $date = (string) ($x['date'] ?? '');
            if ($name === '' || ($date !== '' && !Clean::isDate($date))) {
                return $this->fail(422, 'Each vaccination needs a name and a valid date.');
            }
            $vaccines[] = ['name' => $name, 'date' => $date];
        }
        $declared = $request->boolean('declared');
        DB::table('vaccinations')->upsert([[
            'trip_id' => $t->id, 'user_id' => $u->id, 'name' => self::nameOf($u), 'vaccines_enc' => Crypt::encryptString(json_encode($vaccines)),
            'notes_enc' => Crypt::encryptString(Clean::text($request->input('notes'), 2000)), 'declared' => $declared,
            'declared_at' => $declared ? now() : null, 'updated_at' => now(),
        ]], ['trip_id', 'user_id'], ['name', 'vaccines_enc', 'notes_enc', 'declared', 'declared_at', 'updated_at']);
        return response()->json(['ok' => true]);
    }

    // ---- debrief (welfare and injury references encrypted) ------------------------------------------

    public static function debriefView(?object $d): array
    {
        if (!$d) {
            return ['wentWell' => '', 'couldBeBetter' => '', 'welfareConcerns' => '', 'injuryRefs' => [], 'reciprocityIssues' => false, 'reciprocityDescription' => '', 'updatedBy' => '', 'updatedAtMs' => 0];
        }
        return [
            'wentWell' => $d->went_well, 'couldBeBetter' => $d->could_be_better, 'welfareConcerns' => Crypt::decryptString($d->welfare_concerns_enc),
            'injuryRefs' => json_decode(Crypt::decryptString($d->injury_refs_enc), true) ?: [], 'reciprocityIssues' => (bool) $d->reciprocity_issues,
            'reciprocityDescription' => $d->reciprocity_description, 'updatedBy' => $d->updated_by_name, 'updatedAtMs' => self::ms($d->updated_at),
        ];
    }

    public function debrief(Request $request, string $trip): JsonResponse
    {
        $t = TripAccess::needView($this->me($request), $trip);
        return response()->json(['debrief' => self::debriefView(DB::table('debriefs')->where('trip_id', $t->id)->first())]);
    }

    public function saveDebrief(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $refs = $request->input('injuryRefs', []);
        if (!is_array($refs) || !array_is_list($refs) || count($refs) > 20) {
            return $this->fail(422, 'At most 20 injury references.');
        }
        $refs = array_values(array_filter(array_map(fn ($r) => Clean::text($r, 120), $refs)));
        DB::table('debriefs')->upsert([[
            'trip_id' => $t->id, 'went_well' => Clean::text($request->input('wentWell'), 5000), 'could_be_better' => Clean::text($request->input('couldBeBetter'), 5000),
            'welfare_concerns_enc' => Crypt::encryptString(Clean::text($request->input('welfareConcerns'), 5000)), 'injury_refs_enc' => Crypt::encryptString(json_encode($refs)),
            'reciprocity_issues' => $request->boolean('reciprocityIssues'), 'reciprocity_description' => Clean::text($request->input('reciprocityDescription'), 5000),
            'updated_by' => $u->id, 'updated_by_name' => self::nameOf($u), 'updated_at' => now(),
        ]], ['trip_id'], ['went_well', 'could_be_better', 'welfare_concerns_enc', 'injury_refs_enc', 'reciprocity_issues', 'reciprocity_description', 'updated_by', 'updated_by_name', 'updated_at']);
        return response()->json(['ok' => true]);
    }

    // ---- financial debrief (read by the trip; changed by the owner or HOST) -------------------------

    public static function financeView(object $e): array
    {
        return [
            'id' => $e->id, 'ownerUid' => $e->owner_id, 'ownerName' => $e->owner_name, 'date' => $e->date, 'category' => $e->category, 'description' => $e->description,
            'amount' => (float) $e->amount, 'currency' => $e->currency, 'paymentMethod' => $e->payment_method, 'receiptRef' => $e->receipt_ref, 'updatedAtMs' => self::ms($e->updated_at),
        ];
    }

    public function finance(Request $request, string $trip): JsonResponse
    {
        $t = TripAccess::needView($this->me($request), $trip);
        $notes = [];
        foreach (DB::table('finance_notes')->where('trip_id', $t->id)->get() as $n) {
            $notes[$n->user_id] = ['name' => $n->name, 'text' => $n->text, 'updatedAtMs' => self::ms($n->updated_at)];
        }
        return response()->json([
            'entries' => DB::table('finance_entries')->where('trip_id', $t->id)->get()->map(fn ($e) => self::financeView($e)),
            'notes' => (object) $notes,
        ]);
    }

    public function saveFinance(Request $request, string $trip, ?string $id = null): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $amount = $request->input('amount');
        $description = Clean::text($request->input('description'), 200);
        $currency = Clean::text($request->input('currency'), 10);
        $date = (string) $request->input('date', '');
        if ($description === '' || !(is_int($amount) || is_float($amount)) || $amount < 0 || $amount > 1_000_000 || $currency === '' || ($date !== '' && !Clean::isDate($date))) {
            return $this->fail(422, 'Enter a description, amount and currency.');
        }
        $row = [
            'date' => $date, 'category' => Clean::text($request->input('category'), 40), 'description' => $description, 'amount' => $amount, 'currency' => $currency,
            'payment_method' => Clean::text($request->input('paymentMethod'), 40), 'receipt_ref' => Clean::text($request->input('receiptRef'), 60), 'updated_at' => now(),
        ];
        if ($id === null) {
            $id = (string) Str::ulid();
            DB::table('finance_entries')->insert($row + ['id' => $id, 'trip_id' => $t->id, 'owner_id' => $u->id, 'owner_name' => self::nameOf($u), 'created_at' => now()]);
            return response()->json(['id' => $id], 201);
        }
        $q = DB::table('finance_entries')->where('trip_id', $t->id)->where('id', Clean::isId($id) ? $id : '');
        if (!$u->is_host) {
            $q->where('owner_id', $u->id);
        }
        return $q->update($row) ? response()->json(['id' => $id]) : $this->fail(403, "You can't change this entry.");
    }

    public function deleteFinance(Request $request, string $trip, string $id): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $q = DB::table('finance_entries')->where('trip_id', $t->id)->where('id', Clean::isId($id) ? $id : '');
        if (!$u->is_host) {
            $q->where('owner_id', $u->id);
        }
        return $q->delete() ? response()->json(['ok' => true]) : $this->fail(403, "You can't delete this entry.");
    }

    public function saveFinanceNote(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        DB::table('finance_notes')->upsert([[
            'trip_id' => $t->id, 'user_id' => $u->id, 'name' => self::nameOf($u), 'text' => Clean::text($request->input('text'), 5000), 'updated_at' => now(),
        ]], ['trip_id', 'user_id'], ['name', 'text', 'updated_at']);
        return response()->json(['ok' => true]);
    }

    // ---- trip contacts (a copy of a book entry with the role on this trip) --------------------------

    public static function tripContactView(object $c): array
    {
        return [
            'id' => $c->contact_id, 'name' => $c->name, 'organisation' => $c->organisation, 'jobTitle' => $c->job_title, 'email' => $c->email,
            'phone' => $c->phone, 'country' => $c->country, 'tripRole' => $c->trip_role, 'addedByName' => $c->added_by_name, 'addedAtMs' => self::ms($c->added_at),
        ];
    }

    public function tripContacts(Request $request, string $trip): JsonResponse
    {
        $t = TripAccess::needView($this->me($request), $trip);
        return response()->json(['contacts' => DB::table('trip_contacts')->where('trip_id', $t->id)->orderBy('name')->get()->map(fn ($c) => self::tripContactView($c))]);
    }

    public function addTripContact(Request $request, string $trip, string $contact): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $c = Clean::isId($contact) ? DB::table('contacts')->where('id', $contact)->first() : null;
        abort_unless($c !== null, 404, 'Not found.');
        DB::table('trip_contacts')->upsert([[
            'trip_id' => $t->id, 'contact_id' => $c->id, 'name' => $c->name, 'organisation' => $c->organisation, 'job_title' => $c->job_title, 'email' => $c->email,
            'phone' => $c->phone, 'country' => $c->country, 'trip_role' => Clean::text($request->input('tripRole'), 80), 'added_by' => $u->id,
            'added_by_name' => self::nameOf($u), 'added_at' => now(),
        ]], ['trip_id', 'contact_id'], ['name', 'organisation', 'job_title', 'email', 'phone', 'country', 'trip_role', 'added_by', 'added_by_name', 'added_at']);
        return response()->json(['ok' => true]);
    }

    public function removeTripContact(Request $request, string $trip, string $contact): JsonResponse
    {
        $t = TripAccess::needView($this->me($request), $trip);
        DB::table('trip_contacts')->where('trip_id', $t->id)->where('contact_id', $contact)->delete();
        return response()->json(['ok' => true]);
    }

    // ---- whole-trip export (audited as a sensitive read) --------------------------------------------

    public function snapshot(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $items = [];
        foreach (['flights', 'hotels', 'cars', 'assets'] as $kind) {
            $items[$kind] = DB::table('trip_items')->where('trip_id', $t->id)->where('kind', $kind)->orderBy('created_at')->get()->map(fn ($i) => ItemController::view($i));
        }
        $vacc = DB::table('vaccinations')->where('trip_id', $t->id);
        if (!TripAccess::isLead($u, $t)) {
            $vacc->where('user_id', $u->id);
        }
        $summaries = ['teamLeader' => null, 'spc' => null];
        foreach (DB::table('summaries')->where('trip_id', $t->id)->get() as $s) {
            $summaries[$s->role] = ['text' => $s->text, 'byName' => $s->by_name];
        }
        $notes = [];
        foreach (DB::table('finance_notes')->where('trip_id', $t->id)->get() as $n) {
            $notes[$n->user_id] = ['name' => $n->name, 'text' => $n->text];
        }
        return response()->json(['snapshot' => [
            'trip' => TripController::tripView($t),
            'members' => DB::table('trip_members')->where('trip_id', $t->id)->get()->map(fn ($m) => [
                'uid' => $m->user_id, 'name' => $m->name, 'email' => $m->email, 'reasons' => json_decode($m->reasons, true) ?: [], 'addedByName' => '', 'addedAtMs' => self::ms($m->added_at),
            ]),
            'items' => $items,
            'messages' => DB::table('messages')->where('trip_id', $t->id)->orderBy('created_at')->get()->map(fn ($m) => MessageController::view($m)),
            'attachments' => DB::table('attachments')->where('trip_id', $t->id)->get()->map(fn ($a) => AttachmentController::view($a)),
            'tlRequests' => DB::table('tl_requests')->where('trip_id', $t->id)->get()->map(fn ($r) => self::tlView($r)),
            'summaries' => $summaries,
            'contacts' => DB::table('trip_contacts')->where('trip_id', $t->id)->get()->map(fn ($c) => self::tripContactView($c)),
            'vaccinations' => $vacc->get()->map(fn ($v) => self::vaccView($v)),
            'debrief' => self::debriefView(DB::table('debriefs')->where('trip_id', $t->id)->first()),
            'finance' => DB::table('finance_entries')->where('trip_id', $t->id)->get()->map(fn ($e) => self::financeView($e)),
            'financeNotes' => (object) $notes,
        ]]);
    }
}
