<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Security\SecurityEvents;
use App\Services\Agreements;
use App\Services\Membership;
use App\Support\Clean;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Validation\Rules\Password as PasswordRule;

/**
 * Sign-up, sign-in, sign-out, email confirmation and password reset (spec §2), on Laravel's own
 * session guard via Sanctum's SPA mode. No Fortify (MIGRATION-PLAN review item 8).
 *
 * Every sign-in must carry `agree: true` and the agreement is recorded in the same request — no
 * record, no session. Limits are keyed on the EMAIL, with a generous per-IP ceiling, because
 * Zscaler puts many people behind a few addresses (plan review item 1).
 */
class AuthController extends Controller
{
    public static function sessionView(?User $u): ?array
    {
        if (!$u) {
            return null;
        }
        return [
            'uid' => $u->id, 'email' => $u->email, 'name' => $u->name, 'emailVerified' => $u->isVerified(),
            'isHost' => $u->is_host, 'isAdmin' => $u->is_admin, 'isController' => $u->is_controller, 'isSpcProfile' => $u->is_spc,
        ];
    }

    public function session(Request $request): JsonResponse
    {
        return response()->json(['user' => self::sessionView($request->user())]);
    }

    public static function passwordRule(): PasswordRule
    {
        $rule = PasswordRule::min(10)->max(200);
        return config('security.password.breach_check') ? $rule->uncompromised() : $rule;
    }

    /**
     * Sessions only start for requests from the app's own origin (Sanctum stateful domains), so a
     * script with no Origin/Referer cannot sign in at all.
     */
    private function needsBrowser(Request $request): ?JsonResponse
    {
        return $request->hasSession() ? null : $this->fail(400, 'Sign in from the Voyager app.');
    }

    public function register(Request $request): JsonResponse
    {
        if ($r = $this->needsBrowser($request)) {
            return $r;
        }
        $data = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'email' => ['required', 'string', 'email:rfc', 'max:254'],
            'password' => ['required', 'string', self::passwordRule()],
            'agree' => ['required', 'accepted'],
        ]);
        $email = Clean::email($data['email']);
        if (!$email || !$this->allow("register:{$email}", 3, 3600)) {
            return $this->fail(429, 'Too many attempts. Try again later.');
        }
        if (User::where('email', $email)->exists()) {
            return $this->fail(422, 'An account already exists for that email.');
        }
        $user = DB::transaction(function () use ($data, $email, $request) {
            $u = User::create(['name' => Clean::text($data['name'], 80), 'email' => $email, 'password' => $data['password']]);
            Agreements::record($u, 'signup', $request);
            return $u;
        });
        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        $user->sendEmailVerificationNotification();
        return response()->json(['user' => self::sessionView($user->fresh())], 201);
    }

    public function login(Request $request): JsonResponse
    {
        if ($r = $this->needsBrowser($request)) {
            return $r;
        }
        $data = $request->validate([
            'email' => ['required', 'string', 'max:254'],
            'password' => ['required', 'string', 'max:200'],
            'agree' => ['required', 'accepted'],
        ]);
        $email = Clean::email($data['email']) ?? '';
        $key = "login:{$email}";
        if (!$this->allow("login-ip:{$request->ip()}", 300, 60, false) || RateLimiter::tooManyAttempts($key, 5)) {
            return $this->fail(429, 'Too many attempts. Try again later.');
        }
        $user = $email !== '' ? User::where('email', $email)->first() : null;
        // Same work and the same answer whether or not the account exists (no account discovery).
        $ok = Hash::check($data['password'], $user->password ?? '$2y$12$Nkr0Sl4VBOBAs7MStcdr6uOV7g8DsHKAtkMAXB3N1Q5HhcT064IaS');
        if (!$user || !$ok || $user->password === null) {
            RateLimiter::hit($key, 900);
            if (RateLimiter::attempts($key) === 5) {
                SecurityEvents::record('login_locked', $user?->id, [], 'throttled_15m', $email);
            }
            return $this->fail(422, 'Email or password is incorrect.');
        }
        if ($user->disabled_at !== null) {
            SecurityEvents::record('login_disabled_account', $user->id, [], 'refused', $email);
            return $this->fail(403, 'This account is disabled. Contact an administrator.');
        }
        RateLimiter::clear($key);
        Agreements::record($user, 'password', $request);
        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        return response()->json(['user' => self::sessionView($user->fresh())]);
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }
        return response()->json(['ok' => true]);
    }

    public function resendVerification(Request $request): JsonResponse
    {
        $u = $this->me($request);
        if ($u->isVerified()) {
            return response()->json(['ok' => true]);
        }
        if (!$this->allow("verify-resend:{$u->id}", 3, 600)) {
            return $this->fail(429, 'Too many attempts. Try again later.');
        }
        $u->sendEmailVerificationNotification();
        return response()->json(['ok' => true]);
    }

    /** The signed link is the proof: works signed out and on another device (plan review 13). */
    public function verifyEmail(Request $request): JsonResponse
    {
        $id = (string) $request->input('id', '');
        $hash = (string) $request->input('hash', '');
        if (!Clean::isId($id) || !preg_match('/^[a-f0-9]{40}$/', $hash)) {
            return $this->fail(422, 'This link is invalid.');
        }
        $url = route('verification.verify', ['id' => $id, 'hash' => $hash]) . '?' . http_build_query([
            'expires' => (string) $request->input('expires', ''), 'signature' => (string) $request->input('signature', ''),
        ]);
        $check = Request::create($url, 'POST');
        if (!URL::hasValidSignature($check)) {
            return $this->fail(422, 'This link has expired or is invalid.');
        }
        $user = User::find($id);
        if (!$user || !hash_equals(sha1($user->getEmailForVerification()), $hash)) {
            return $this->fail(422, 'This link is invalid.');
        }
        if (!$user->isVerified()) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }
        Membership::claimPending($user->id, $user->email);
        return response()->json(['ok' => true]);
    }

    /** Same answer whether or not the account exists. */
    public function forgotPassword(Request $request): JsonResponse
    {
        $email = Clean::email($request->input('email'));
        if ($email && $this->allow("reset:{$email}", 3, 3600) && $this->allow("reset-ip:{$request->ip()}", 100, 3600, false)) {
            Password::broker()->sendResetLink(['email' => $email]);
        }
        return response()->json(['ok' => true]);
    }

    public function checkResetToken(Request $request): JsonResponse
    {
        $email = Clean::email($request->input('email'));
        $user = $email ? User::where('email', $email)->first() : null;
        if (!$user || !Password::broker()->tokenExists($user, (string) $request->input('token', ''))) {
            return $this->fail(422, 'This link has expired or is invalid.');
        }
        return response()->json(['email' => $user->email]);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'max:254'],
            'token' => ['required', 'string', 'max:200'],
            'password' => ['required', 'string', self::passwordRule()],
        ]);
        $status = Password::broker()->reset(
            ['email' => Clean::email($data['email']) ?? '', 'token' => $data['token'], 'password' => $data['password']],
            function (User $user, string $password) {
                // Using the emailed link proves the inbox, so the address counts as confirmed.
                $user->forceFill(['password' => $password, 'email_verified_at' => $user->email_verified_at ?? now()])->save();
                DB::table('sessions')->where('user_id', $user->id)->delete();
                DB::table('users')->where('id', $user->id)->update(['remember_token' => null]);
                Membership::claimPending($user->id, $user->email);
            },
        );
        if ($status !== Password::PASSWORD_RESET) {
            return $this->fail(422, 'This link has expired or is invalid.');
        }
        return response()->json(['ok' => true]);
    }

    /** Fixed-window limiter; `$record` adds a security event when the limit is first hit. */
    private function allow(string $key, int $max, int $decay, bool $record = true): bool
    {
        if (RateLimiter::tooManyAttempts($key, $max)) {
            return false;
        }
        RateLimiter::hit($key, $decay);
        if ($record && RateLimiter::attempts($key) === $max) {
            SecurityEvents::record('rate_limit_reached', null, ['key' => explode(':', $key)[0]], 'throttled');
        }
        return true;
    }
}
