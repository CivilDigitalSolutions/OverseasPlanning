<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Security\SecurityEvents;
use App\Services\Membership;
use App\Services\TripAccess;
use App\Support\Clean;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

/**
 * The in-app directory, the global contacts book, notifications/push, and the Administrator
 * account manager (role profiles HOST, Controller, SPC, Administrator — the ONLY way roles change).
 */
class PeopleController extends Controller
{
    // ---- directory: everyone with a confirmed account (names + emails for the people pickers) -----

    public function directory(Request $request): JsonResponse
    {
        $rows = DB::table('users')->whereNotNull('email_verified_at')->whereNull('disabled_at')->orderBy('name')->limit(5000)->get(['id', 'name', 'email', 'is_spc']);
        return response()->json(['people' => $rows->map(fn ($p) => ['uid' => $p->id, 'name' => $p->name, 'email' => $p->email, 'spc' => (bool) $p->is_spc])]);
    }

    // ---- contacts book: anyone verified adds and edits; only HOST deletes ---------------------------

    public static function contactView(object $c): array
    {
        return [
            'id' => $c->id, 'name' => $c->name, 'organisation' => $c->organisation, 'jobTitle' => $c->job_title, 'email' => $c->email, 'phone' => $c->phone,
            'country' => $c->country, 'notes' => $c->notes, 'createdBy' => $c->created_by, 'createdByName' => $c->created_by_name, 'updatedAtMs' => self::ms($c->updated_at),
        ];
    }

    public function contacts(Request $request): JsonResponse
    {
        return response()->json(['contacts' => DB::table('contacts')->orderBy('name')->limit(10000)->get()->map(fn ($c) => self::contactView($c))]);
    }

    public function saveContact(Request $request, ?string $id = null): JsonResponse
    {
        $u = $this->me($request);
        $name = Clean::text($request->input('name'), 80);
        $email = trim((string) $request->input('email', ''));
        if ($name === '') {
            return $this->fail(422, 'Enter a name.');
        }
        if ($email !== '' && !Clean::email($email)) {
            return $this->fail(422, 'Enter a valid email.');
        }
        $row = [
            'name' => $name, 'organisation' => Clean::text($request->input('organisation'), 120), 'job_title' => Clean::text($request->input('jobTitle'), 80),
            'email' => $email === '' ? '' : Clean::email($email), 'phone' => Clean::text($request->input('phone'), 40), 'country' => Clean::text($request->input('country'), 80),
            'notes' => Clean::text($request->input('notes'), 2000), 'updated_at' => now(),
        ];
        if ($id === null) {
            if (DB::table('contacts')->count() >= 20000) {
                return $this->fail(429, 'The contacts book is full.');
            }
            $id = (string) Str::ulid();
            DB::table('contacts')->insert($row + ['id' => $id, 'created_by' => $u->id, 'created_by_name' => self::nameOf($u), 'created_at' => now()]);
            return response()->json(['id' => $id], 201);
        }
        $n = Clean::isId($id) ? DB::table('contacts')->where('id', $id)->update($row) : 0;
        return $n ? response()->json(['id' => $id]) : $this->fail(404, 'Not found.');
    }

    public function deleteContact(Request $request, string $id): JsonResponse
    {
        TripAccess::needHost($this->me($request));
        $n = Clean::isId($id) ? DB::table('contacts')->where('id', $id)->delete() : 0;
        return $n ? response()->json(['ok' => true]) : $this->fail(404, 'Not found.');
    }

    // ---- notifications + push -------------------------------------------------------------------------

    public function notifications(Request $request): JsonResponse
    {
        $rows = DB::table('app_notifications')->where('user_id', $this->me($request)->id)->orderByDesc('created_at')->limit(50)->get();
        return response()->json(['notifications' => $rows->map(fn ($n) => [
            'id' => $n->id, 'type' => $n->type, 'title' => $n->title, 'body' => $n->body, 'tripId' => $n->trip_id, 'link' => $n->link, 'read' => (bool) $n->read, 'createdAtMs' => self::ms($n->created_at),
        ])]);
    }

    public function markNotification(Request $request, string $id): JsonResponse
    {
        DB::table('app_notifications')->where('user_id', $this->me($request)->id)->where('id', $id)->update(['read' => true]);
        return response()->json(['ok' => true]);
    }

    public function clearNotification(Request $request, string $id): JsonResponse
    {
        DB::table('app_notifications')->where('user_id', $this->me($request)->id)->where('id', $id)->delete();
        return response()->json(['ok' => true]);
    }

    public function pushKey(): JsonResponse
    {
        return response()->json(['publicKey' => (string) config('services.webpush.public_key')]);
    }

    public function subscribePush(Request $request): JsonResponse
    {
        $u = $this->me($request);
        $endpoint = $request->input('endpoint');
        $p256dh = $request->input('keys.p256dh');
        $auth = $request->input('keys.auth');
        $host = is_string($endpoint) ? parse_url($endpoint, PHP_URL_HOST) : null;
        if (!is_string($endpoint) || strlen($endpoint) > 1000 || !str_starts_with($endpoint, 'https://') || !$host || !is_string($p256dh) || strlen($p256dh) > 200 || !is_string($auth) || strlen($auth) > 100) {
            return $this->fail(422, 'Invalid push subscription.');
        }
        // Only real browser push services (an endpoint is a URL the SERVER will call — SSRF guard).
        if (!collect(config('services.webpush.allowed_hosts'))->contains(fn ($h) => $host === $h || str_ends_with($host, ".{$h}"))) {
            return $this->fail(422, 'Unsupported push service.');
        }
        if (DB::table('push_subscriptions')->where('user_id', $u->id)->count() >= 10) {
            DB::table('push_subscriptions')->where('user_id', $u->id)->orderBy('updated_at')->limit(1)->delete();
        }
        DB::table('push_subscriptions')->upsert([[
            'id' => (string) Str::ulid(), 'user_id' => $u->id, 'endpoint' => $endpoint, 'endpoint_hash' => hash('sha256', $endpoint), 'p256dh' => $p256dh, 'auth' => $auth,
            'user_agent' => mb_substr((string) $request->userAgent(), 0, 200), 'created_at' => now(), 'updated_at' => now(),
        ]], ['endpoint_hash'], ['user_id', 'p256dh', 'auth', 'user_agent', 'updated_at']);
        return response()->json(['ok' => true]);
    }

    public function unsubscribePush(Request $request): JsonResponse
    {
        $endpoint = (string) $request->input('endpoint', '');
        DB::table('push_subscriptions')->where('user_id', $this->me($request)->id)->where('endpoint_hash', hash('sha256', $endpoint))->delete();
        return response()->json(['ok' => true]);
    }

    // ---- Administrator account manager ----------------------------------------------------------------

    private static function roles(mixed $raw): array
    {
        $r = is_array($raw) ? $raw : [];
        return ['host' => ($r['host'] ?? false) === true, 'controller' => ($r['controller'] ?? false) === true, 'spc' => ($r['spc'] ?? false) === true, 'admin' => ($r['admin'] ?? false) === true];
    }

    private static function logRoles(string $uid, string $email, array $changes, string $by): void
    {
        DB::table('role_changes')->insert(['id' => (string) Str::ulid(), 'user_id' => $uid, 'email' => $email, 'changes' => json_encode($changes), 'by_user_id' => $by, 'created_at' => now()]);
        SecurityEvents::record('role_change', $uid, $changes, null, $email);
    }

    public function accounts(Request $request): JsonResponse
    {
        TripAccess::needAdmin($this->me($request));
        $rows = User::query()->orderBy('name')->limit(5000)->get();
        return response()->json(['accounts' => $rows->map(fn (User $a) => [
            'uid' => $a->id, 'name' => $a->name, 'email' => $a->email, 'emailVerified' => $a->isVerified(), 'disabled' => $a->disabled_at !== null,
            'roles' => $a->roleProfiles(), 'createdAt' => (string) $a->created_at?->toIso8601String(), 'lastSignIn' => (string) $a->last_login_at?->toIso8601String(),
        ])]);
    }

    /** Creates the account and EMAILS the person a set-password link (never shown to the administrator). */
    public function createAccount(Request $request): JsonResponse
    {
        $admin = $this->me($request);
        TripAccess::needAdmin($admin);
        $email = Clean::email($request->input('email'));
        $name = Clean::text($request->input('name'), 80);
        if (!$email || $name === '') {
            return $this->fail(422, 'Enter a name and a valid email.');
        }
        if (User::where('email', $email)->exists()) {
            return $this->fail(409, 'An account already exists for that email.');
        }
        $roles = self::roles($request->input('roles'));
        $user = DB::transaction(function () use ($email, $name, $roles, $admin) {
            $u = new User(['name' => $name, 'email' => $email]);
            // The administrator vouches for the address; the person still proves the inbox by using the link.
            $u->forceFill([
                'email_verified_at' => now(), 'created_by_admin' => $admin->id,
                'is_host' => $roles['host'], 'is_controller' => $roles['controller'], 'is_spc' => $roles['spc'], 'is_admin' => $roles['admin'],
            ])->save();
            self::logRoles($u->id, $email, ['created' => true, 'roles' => $roles], $admin->id);
            return $u;
        });
        $token = Password::broker()->createToken($user);
        $user->notify(new \App\Notifications\ResetPasswordLink($token, true));
        Membership::claimPending($user->id, $user->email);
        return response()->json(['uid' => $user->id, 'setupLink' => ''], 201);
    }

    public function setRoles(Request $request, string $id): JsonResponse
    {
        $admin = $this->me($request);
        TripAccess::needAdmin($admin);
        $target = Clean::isId($id) ? User::find($id) : null;
        if (!$target) {
            return $this->fail(404, 'Account not found.');
        }
        $roles = self::roles($request->input('roles'));
        if ($target->id === $admin->id && !$roles['admin']) {
            return $this->fail(422, "You can't remove your own Administrator permission.");
        }
        $target->forceFill(['is_host' => $roles['host'], 'is_controller' => $roles['controller'], 'is_spc' => $roles['spc'], 'is_admin' => $roles['admin']])->save();
        self::logRoles($target->id, $target->email, ['roles' => $roles], $admin->id);
        return response()->json(['ok' => true]);
    }

    /** Older single-role form: {email, role, on}. */
    public function setRole(Request $request): JsonResponse
    {
        $admin = $this->me($request);
        TripAccess::needAdmin($admin);
        $email = Clean::email($request->input('email'));
        $role = $request->input('role');
        if (!$email || !in_array($role, ['host', 'controller', 'spc', 'admin'], true)) {
            return $this->fail(422, 'Enter a valid email and role.');
        }
        $target = User::where('email', $email)->first();
        if (!$target) {
            return $this->fail(404, 'No account with that email.');
        }
        $roles = $target->roleProfiles();
        $roles[$role] = $request->boolean('on');
        $request->merge(['roles' => $roles]);
        $res = $this->setRoles($request, $target->id);
        return $res->status() === 200 ? response()->json(['uid' => $target->id]) : $res;
    }

    /** Takes the person off every trip, deletes their passkeys and login. Audit records stay. */
    public function deleteAccount(Request $request, string $id): JsonResponse
    {
        $admin = $this->me($request);
        TripAccess::needAdmin($admin);
        $target = Clean::isId($id) ? User::find($id) : null;
        if (!$target) {
            return $this->fail(404, 'Account not found.');
        }
        if ($target->id === $admin->id) {
            return $this->fail(422, "You can't delete your own account here.");
        }
        $tripIds = DB::table('trip_members')->where('user_id', $target->id)->pluck('trip_id');
        DB::transaction(function () use ($target, $tripIds) {
            foreach ($tripIds as $tripId) {
                $t = DB::table('trips')->where('id', $tripId)->lockForUpdate()->first();
                $roles = json_decode($t->roles, true) ?: [];
                foreach ($roles as $k => $r) {
                    if (($r['uid'] ?? null) === $target->id) {
                        $roles[$k]['uid'] = null;
                    }
                }
                DB::table('trips')->where('id', $tripId)->update([
                    'roles' => json_encode($roles, JSON_FORCE_OBJECT),
                    'extra_access_uids' => json_encode(array_values(array_diff(json_decode($t->extra_access_uids, true) ?: [], [$target->id]))),
                    'requester_id' => $t->requester_id === $target->id ? null : $t->requester_id,
                ]);
                foreach (DB::table('trip_items')->where('trip_id', $tripId)->where('kind', 'flights')->get() as $f) {
                    $v = json_decode($f->values, true) ?: [];
                    $changed = false;
                    foreach ($v['passengers'] ?? [] as $i => $p) {
                        if (($p['uid'] ?? null) === $target->id) {
                            $v['passengers'][$i] = ['name' => $p['name'], 'travelClass' => $p['travelClass']];
                            $changed = true;
                        }
                    }
                    if ($changed) {
                        DB::table('trip_items')->where('id', $f->id)->update(['values' => json_encode($v)]);
                    }
                }
            }
            DB::table('sessions')->where('user_id', $target->id)->delete();
            $target->delete();
        });
        foreach ($tripIds as $tripId) {
            Membership::recompute($tripId);
        }
        self::logRoles($target->id, $target->email, ['deleted' => true], $admin->id);
        return response()->json(['ok' => true, 'tripsUpdated' => count($tripIds)]);
    }
}
