<?php

namespace App\Http\Controllers;

use App\Security\AnomalyDetector;
use App\Services\Membership;
use App\Services\TripAccess;
use App\Support\Clean;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Trip requests (the short form → HOST triage), trips, their overview, roles and access.
 * Ports firestore.rules `tripRequests` / `trips` and functions createTrip, updateTripRoles,
 * addTripAccess, removeTripAccess, syncPendingAccess and listLiveTrips.
 */
class TripController extends Controller
{
    // ---- trip requests --------------------------------------------------------------------------

    public static function requestView(object $r): array
    {
        return [
            'id' => $r->id, 'teamName' => $r->team_name, 'startDate' => $r->start_date, 'endDate' => $r->end_date, 'location' => $r->location,
            'requesterUid' => $r->requester_id, 'requesterName' => $r->requester_name, 'requesterEmail' => $r->requester_email,
            'status' => $r->status, 'tripId' => $r->trip_id, 'declineReason' => $r->decline_reason, 'createdAtMs' => self::ms($r->created_at),
        ];
    }

    /** HOST sees every request; everyone else their own. */
    public function requests(Request $request): JsonResponse
    {
        $u = $this->me($request);
        $q = DB::table('trip_requests')->orderByDesc('created_at');
        if (!$u->is_host) {
            $q->where('requester_id', $u->id);
        }
        return response()->json(['requests' => $q->limit(500)->get()->map(fn ($r) => self::requestView($r))]);
    }

    public function showRequest(Request $request, string $id): JsonResponse
    {
        $u = $this->me($request);
        $r = Clean::isId($id) ? DB::table('trip_requests')->where('id', $id)->first() : null;
        if (!$r || (!$u->is_host && $r->requester_id !== $u->id)) {
            TripAccess::deny($u, "request:{$id}");
        }
        return response()->json(['request' => self::requestView($r)]);
    }

    public function submitRequest(Request $request): JsonResponse
    {
        $u = $this->me($request);
        $d = $request->validate([
            'teamName' => ['required', 'string', 'max:40'], 'location' => ['required', 'string', 'max:120'],
            'startDate' => ['required', 'date_format:Y-m-d'], 'endDate' => ['required', 'date_format:Y-m-d', 'after_or_equal:startDate'],
        ]);
        if (!TeamController::exists($d['teamName'])) {
            return $this->fail(422, 'Choose a team from the list.');
        }
        $id = (string) Str::ulid();
        DB::table('trip_requests')->insert([
            'id' => $id, 'team_name' => $d['teamName'], 'location' => Clean::text($d['location'], 120),
            'start_date' => $d['startDate'], 'end_date' => $d['endDate'], 'requester_id' => $u->id, 'requester_name' => self::nameOf($u),
            'requester_email' => $u->email, 'status' => 'submitted', 'created_at' => now(), 'updated_at' => now(),
        ]);
        return response()->json(['id' => $id], 201);
    }

    public function declineRequest(Request $request, string $id): JsonResponse
    {
        $u = $this->me($request);
        TripAccess::needHost($u);
        $n = Clean::isId($id) ? DB::table('trip_requests')->where('id', $id)->where('status', 'submitted')->update([
            'status' => 'declined', 'decline_reason' => Clean::text($request->input('reason'), 500), 'decided_by' => $u->id, 'decided_at' => now(), 'updated_at' => now(),
        ]) : 0;
        return $n ? response()->json(['ok' => true]) : $this->fail(409, 'This request has already been handled.');
    }

    // ---- trips ------------------------------------------------------------------------------------

    public static function tripView(object $t, bool $basicOnly = false): array
    {
        $roles = is_array($t->roles) ? $t->roles : (json_decode($t->roles, true) ?: []);
        $base = [
            'id' => $t->id, 'name' => $t->name, 'teamName' => $t->team_name, 'location' => $t->location, 'startDate' => $t->start_date,
            'endDate' => $t->end_date, 'status' => $t->status, 'cyberRisk' => $t->cyber_risk, 'countryRisk' => $t->country_risk,
        ];
        if ($basicOnly) {
            // Controllers (SECURITY-PLAN T7): role holders' NAMES only, no planning data.
            $base['roles'] = array_map(fn ($r) => ['name' => $r['name'] ?? '', 'email' => '', 'uid' => null], array_filter($roles, fn ($r) => !empty($r['name'])));
            return $base;
        }
        return $base + [
            'cyberRationale' => $t->cyber_rationale, 'countryRationale' => $t->country_rationale,
            'roles' => array_map(fn ($r) => ['name' => $r['name'] ?? '', 'email' => $r['email'] ?? '', 'uid' => $r['uid'] ?? null], $roles),
            'memberUids' => DB::table('trip_members')->where('trip_id', $t->id)->pluck('user_id'),
            'pendingEmails' => DB::table('trip_pending_emails')->where('trip_id', $t->id)->pluck('email'),
            'requestId' => $t->request_id, 'createdByName' => $t->created_by_name, 'createdByEmail' => $t->created_by_email,
            'dipAgreed' => (bool) $t->dip_agreed, 'dipAgreedDate' => $t->dip_agreed_date, 'dipClassification' => $t->dip_classification,
            'updatedByName' => $t->updated_by_name, 'updatedAtMs' => self::ms($t->updated_at), 'createdAtMs' => self::ms($t->created_at),
        ];
    }

    /** HOST sees every trip; everyone else the trips they are on. */
    public function trips(Request $request): JsonResponse
    {
        $u = $this->me($request);
        $q = DB::table('trips')->orderBy('start_date');
        if (!$u->is_host) {
            $q->whereIn('id', DB::table('trip_members')->where('user_id', $u->id)->select('trip_id'));
        }
        return response()->json(['trips' => $q->limit(1000)->get()->map(fn ($t) => self::tripView($t))]);
    }

    public function show(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needMessages($u, $trip);
        app(AnomalyDetector::class)->openedTrip($u, $t->id);
        return response()->json(['trip' => self::tripView($t, !TripAccess::canView($u, $t))]);
    }

    /** Controllers: every live trip, basic details only. */
    public function liveTrips(Request $request): JsonResponse
    {
        $u = $this->me($request);
        if (!$u->is_controller) {
            TripAccess::deny($u, 'live-trips', 403);
        }
        $trips = DB::table('trips')->whereIn('status', ['planning', 'live'])->get()
            ->filter(fn ($t) => Clean::isLive($t->status, $t->start_date))->values()->map(fn ($t) => self::tripView($t, true));
        return response()->json(['trips' => $trips]);
    }

    /** HOST turns a submitted request into a trip with risk levels and the four basic roles. */
    public function create(Request $request): JsonResponse
    {
        $u = $this->me($request);
        TripAccess::needHost($u);
        $requestId = (string) $request->input('requestId', '');
        if (!Clean::isId($requestId)) {
            return $this->fail(422, 'Unknown request.');
        }
        try {
            $cyber = Clean::risk($request->input('cyberRisk'), $request->input('cyberRationale'), 'cyber');
            $country = Clean::risk($request->input('countryRisk'), $request->input('countryRationale'), 'country');
        } catch (\InvalidArgumentException $e) {
            return $this->fail(422, $e->getMessage());
        }
        [$roles, $err] = Clean::roles($request->input('roles'));
        if ($err) {
            return $this->fail(422, $err);
        }
        $tripId = (string) Str::ulid();
        $ok = DB::transaction(function () use ($u, $requestId, $request, $cyber, $country, $roles, $tripId) {
            $r = DB::table('trip_requests')->where('id', $requestId)->lockForUpdate()->first();
            if (!$r || $r->status !== 'submitted') {
                return false;
            }
            DB::table('trips')->insert([
                'id' => $tripId, 'name' => Clean::text($request->input('name'), 120) ?: "{$r->team_name} – {$r->location}",
                'team_name' => $r->team_name, 'location' => $r->location, 'start_date' => $r->start_date, 'end_date' => $r->end_date, 'status' => 'planning',
                'cyber_risk' => $cyber['level'], 'cyber_rationale' => $cyber['rationale'], 'country_risk' => $country['level'], 'country_rationale' => $country['rationale'],
                'roles' => json_encode(self::resolveRoles($roles), JSON_FORCE_OBJECT), 'request_id' => $requestId, 'requester_id' => $r->requester_id,
                'created_by' => $u->id, 'created_by_name' => self::nameOf($u), 'created_by_email' => $u->email, 'created_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('trip_requests')->where('id', $requestId)->update(['status' => 'accepted', 'trip_id' => $tripId, 'decided_by' => $u->id, 'decided_at' => now(), 'updated_at' => now()]);
            return true;
        });
        if (!$ok) {
            return $this->fail(409, 'This request has already been handled.');
        }
        Membership::recompute($tripId, $u->id);
        return response()->json(['tripId' => $tripId], 201);
    }

    /**
     * A role email becomes a uid only for an account that has CONFIRMED that address
     * (SECURITY-PLAN T2); otherwise it waits as pending.
     */
    private static function resolveRoles(array $roles): array
    {
        $out = [];
        foreach ($roles as $k => $r) {
            $uid = $r['email'] !== '' ? DB::table('users')->where('email', $r['email'])->whereNotNull('email_verified_at')->whereNull('disabled_at')->value('id') : null;
            $out[$k] = ['name' => $r['name'], 'email' => $r['email'], 'uid' => $uid];
        }
        return $out;
    }

    /** Overview fields (anyone on the trip), DiP, and status (HOST or the Team Leader only). */
    public function update(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $map = [
            'name' => ['name', 120, true], 'location' => ['location', 120, true],
            'cyberRationale' => ['cyber_rationale', 2000, false], 'countryRationale' => ['country_rationale', 2000, false],
            'createdByName' => ['created_by_name', 80, false], 'createdByEmail' => ['created_by_email', 254, false],
        ];
        $patch = [];
        foreach ($request->all() as $key => $value) {
            if (isset($map[$key])) {
                [$col, $max, $required] = $map[$key];
                $v = Clean::text($value, $max);
                if ($required && $v === '') {
                    return $this->fail(422, 'This field is required.');
                }
                $patch[$col] = $v;
            } elseif ($key === 'teamName') {
                // A changed team must come from the list; a trip keeps a team that was later removed.
                if ($value !== $t->team_name && !TeamController::exists($value)) {
                    return $this->fail(422, 'Choose a team from the list.');
                }
                $patch['team_name'] = $value;
            } elseif ($key === 'startDate' || $key === 'endDate') {
                if (!Clean::isDate($value)) {
                    return $this->fail(422, 'Enter a valid date.');
                }
                $patch[$key === 'startDate' ? 'start_date' : 'end_date'] = $value;
            } elseif ($key === 'cyberRisk' || $key === 'countryRisk') {
                if (!in_array($value, Clean::RISK_LEVELS, true)) {
                    return $this->fail(422, 'Choose a risk level.');
                }
                $patch[$key === 'cyberRisk' ? 'cyber_risk' : 'country_risk'] = $value;
            } elseif ($key === 'dipClassification') {
                if ($value !== '' && !in_array($value, Clean::DIP_CLASSIFICATIONS, true)) {
                    return $this->fail(422, 'Choose a DiP classification.');
                }
                $patch['dip_classification'] = $value;
            } elseif ($key === 'dipAgreed') {
                $date = $request->input('dipAgreedDate', '');
                if (!is_bool($value) || ($value && !Clean::isDate($date))) {
                    return $this->fail(422, 'An agreed DiP needs its date.');
                }
                $patch['dip_agreed'] = $value;
                $patch['dip_agreed_date'] = $value ? $date : '';
            } elseif ($key === 'dipAgreedDate') {
                continue; // handled with dipAgreed
            } elseif ($key === 'status') {
                if (!in_array($value, Clean::TRIP_STATUSES, true)) {
                    return $this->fail(422, 'Unknown status.');
                }
                TripAccess::needLead($u, $t);
                $patch['status'] = $value;
            } else {
                return $this->fail(422, 'That field cannot be changed here.');
            }
        }
        $start = $patch['start_date'] ?? $t->start_date;
        $end = $patch['end_date'] ?? $t->end_date;
        if ($end < $start) {
            return $this->fail(422, 'The end date is before the start date.');
        }
        if ($patch) {
            DB::table('trips')->where('id', $t->id)->update($patch + ['updated_by' => $u->id, 'updated_by_name' => self::nameOf($u), 'updated_at' => now()]);
        }
        return response()->json(['ok' => true]);
    }

    /** Anyone on the trip changes the role holders; access is then recomputed. */
    public function updateRoles(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        [$roles, $err] = Clean::roles($request->input('roles'));
        if ($err) {
            return $this->fail(422, $err);
        }
        DB::table('trips')->where('id', $t->id)->update([
            'roles' => json_encode(self::resolveRoles($roles), JSON_FORCE_OBJECT), 'updated_by' => $u->id, 'updated_by_name' => self::nameOf($u), 'updated_at' => now(),
        ]);
        Membership::recompute($t->id, $u->id);
        return response()->json(['ok' => true]);
    }

    public function members(Request $request, string $trip): JsonResponse
    {
        $t = TripAccess::needView($this->me($request), $trip);
        $rows = DB::table('trip_members')->where('trip_id', $t->id)->orderBy('name')->get()->map(fn ($m) => [
            'uid' => $m->user_id, 'name' => $m->name, 'email' => $m->email, 'reasons' => json_decode($m->reasons, true) ?: [], 'addedByName' => '', 'addedAtMs' => self::ms($m->added_at),
        ]);
        return response()->json(['members' => $rows]);
    }

    /** Additional access: a person from the directory (uid) or an email (pending until they confirm it). */
    public function addAccess(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $uid = $request->input('uid');
        $email = null;
        if (is_string($uid) && Clean::isId($uid)) {
            if (!DB::table('users')->where('id', $uid)->whereNotNull('email_verified_at')->exists()) {
                return $this->fail(404, "That person isn't in the directory.");
            }
        } else {
            $email = Clean::email($request->input('email'));
            if (!$email) {
                return $this->fail(422, 'Choose a person or enter a valid email.');
            }
            $uid = DB::table('users')->where('email', $email)->whereNotNull('email_verified_at')->whereNull('disabled_at')->value('id');
        }
        $status = DB::transaction(function () use ($t, $uid, $email) {
            $row = DB::table('trips')->where('id', $t->id)->lockForUpdate()->first();
            $uids = json_decode($row->extra_access_uids, true) ?: [];
            $emails = json_decode($row->extra_access_emails, true) ?: [];
            if ($uid) {
                if (DB::table('trip_members')->where('trip_id', $t->id)->where('user_id', $uid)->exists()) {
                    return 'already';
                }
                if (DB::table('trip_members')->where('trip_id', $t->id)->count() >= 200) {
                    return 'full';
                }
                $uids = array_values(array_unique([...$uids, $uid]));
                $emails = array_values(array_diff($emails, [$email]));
            } else {
                if (in_array($email, $emails, true)) {
                    return 'already';
                }
                if (count($emails) >= 200) {
                    return 'full';
                }
                $emails[] = $email;
            }
            DB::table('trips')->where('id', $t->id)->update(['extra_access_uids' => json_encode($uids), 'extra_access_emails' => json_encode($emails)]);
            return $uid ? 'added' : 'pending';
        });
        if ($status === 'full') {
            return $this->fail(429, 'This trip has the maximum number of people.');
        }
        if ($status !== 'already') {
            Membership::recompute($t->id, $u->id);
        }
        return response()->json(['status' => $status]);
    }

    /** HOST removes ADDITIONAL access; people in a role, on a flight or the requester keep theirs. */
    public function removeAccess(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        TripAccess::needHost($u);
        $t = TripAccess::needView($u, $trip);
        $uid = $request->input('uid');
        $email = Clean::email($request->input('email'));
        $row = DB::table('trips')->where('id', $t->id)->first();
        $uids = json_decode($row->extra_access_uids, true) ?: [];
        $emails = json_decode($row->extra_access_emails, true) ?: [];
        if (is_string($uid) && Clean::isId($uid)) {
            $uids = array_values(array_diff($uids, [$uid]));
        } elseif ($email) {
            $emails = array_values(array_diff($emails, [$email]));
        } else {
            return $this->fail(422, 'Nothing to remove.');
        }
        DB::table('trips')->where('id', $t->id)->update(['extra_access_uids' => json_encode($uids), 'extra_access_emails' => json_encode($emails)]);
        $res = Membership::recompute($t->id);
        return response()->json(['ok' => true, 'stillOnTripAs' => is_string($uid) ? ($res['members'][$uid]['reasons'] ?? []) : []]);
    }

    public function syncPending(Request $request): JsonResponse
    {
        $u = $this->me($request);
        return response()->json(['added' => Membership::claimPending($u->id, $u->email)]);
    }
}
