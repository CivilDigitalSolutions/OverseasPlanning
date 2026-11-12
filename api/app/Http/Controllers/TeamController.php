<?php

namespace App\Http\Controllers;

use App\Security\SecurityEvents;
use App\Services\TripAccess;
use App\Support\Clean;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Teams (owner decision 2026-11-12): trip requests pick their team from this list; only
 * Administrators add, rename or remove teams. Trips keep the team name they were given.
 */
class TeamController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(['teams' => DB::table('teams')->orderBy('name')->get(['id', 'name'])]);
    }

    public function store(Request $request): JsonResponse
    {
        $u = $this->me($request);
        TripAccess::needAdmin($u);
        $name = Clean::teamName($request->input('name'));
        if ($error = $this->problem($name)) {
            return $this->fail(422, $error);
        }
        $id = (string) Str::ulid();
        DB::table('teams')->insert(['id' => $id, 'name' => $name, 'created_by' => $u->id, 'created_at' => now(), 'updated_at' => now()]);
        SecurityEvents::record('team_added', $u->id, ['team' => $name]);
        return response()->json(['id' => $id], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $u = $this->me($request);
        TripAccess::needAdmin($u);
        $name = Clean::teamName($request->input('name'));
        if ($error = $this->problem($name, $id)) {
            return $this->fail(422, $error);
        }
        $n = Clean::isId($id) ? DB::table('teams')->where('id', $id)->update(['name' => $name, 'updated_at' => now()]) : 0;
        if ($n) {
            SecurityEvents::record('team_renamed', $u->id, ['id' => $id, 'team' => $name]);
        }
        return $n ? response()->json(['ok' => true]) : $this->fail(404, 'Not found.');
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $u = $this->me($request);
        TripAccess::needAdmin($u);
        $team = Clean::isId($id) ? DB::table('teams')->where('id', $id)->first() : null;
        if (!$team) {
            return $this->fail(404, 'Not found.');
        }
        DB::table('teams')->where('id', $id)->delete();
        SecurityEvents::record('team_removed', $u->id, ['team' => $team->name]);
        return response()->json(['ok' => true]);
    }

    private function problem(?string $name, ?string $exceptId = null): ?string
    {
        if ($name === null) {
            return 'Use letters, numbers, spaces, dots or dashes (up to 40).';
        }
        $q = DB::table('teams')->whereRaw('lower(name) = ?', [mb_strtolower($name)]);
        if ($exceptId) {
            $q->where('id', '!=', $exceptId);
        }
        return $q->exists() ? 'That team already exists.' : null;
    }

    /** Is this one of the Administrators' teams? (Trip requests and team changes must use one.) */
    public static function exists(mixed $name): bool
    {
        return is_string($name) && DB::table('teams')->where('name', $name)->exists();
    }
}
