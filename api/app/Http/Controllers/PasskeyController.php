<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Security\SecurityEvents;
use App\Services\Agreements;
use App\Support\Clean;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use lbuchs\WebAuthn\Binary\ByteBuffer;
use lbuchs\WebAuthn\WebAuthn;

/**
 * Passkeys — fingerprint, face, Windows Hello or a security key (spec §2). WebAuthn ceremonies
 * are verified here with USER VERIFICATION REQUIRED (the device checked the person, not just
 * presence) and discoverable credentials, so sign-in needs no email. Challenges live 5 minutes,
 * are single-use and bound to the ceremony type (and to the user for registration).
 * A successful passkey sign-in records the terms agreement exactly like a password sign-in.
 */
class PasskeyController extends Controller
{
    private const TTL = 300;

    private function webauthn(): WebAuthn
    {
        return new WebAuthn((string) config('voyager.rp_name'), (string) config('voyager.passkey_rp_id'), ['none', 'packed', 'apple', 'android-key', 'android-safetynet', 'fido-u2f', 'tpm'], true);
    }

    private static function b64u(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    private static function bin(mixed $b64u): string
    {
        if (!is_string($b64u) || $b64u === '' || strlen($b64u) > 20000 || !preg_match('/^[A-Za-z0-9_-]+$/', $b64u)) {
            throw new \InvalidArgumentException('bad encoding');
        }
        return ByteBuffer::fromBase64Url($b64u)->getBinaryString();
    }

    /** Store a single-use challenge; returns its id. */
    private function putChallenge(string $type, string $challenge, ?string $uid = null): string
    {
        $id = (string) Str::ulid();
        Cache::put("passkey:{$id}", ['type' => $type, 'challenge' => base64_encode($challenge), 'uid' => $uid], self::TTL);
        return $id;
    }

    private function takeChallenge(mixed $id, string $type, ?string $uid = null): ?string
    {
        if (!is_string($id) || !Clean::isId($id)) {
            return null;
        }
        $c = Cache::pull("passkey:{$id}");
        if (!is_array($c) || $c['type'] !== $type || ($uid !== null && $c['uid'] !== $uid)) {
            return null;
        }
        return base64_decode($c['challenge']);
    }

    // ---- registration (signed in) -------------------------------------------------------------------

    public function registrationOptions(Request $request): JsonResponse
    {
        $u = $this->me($request);
        if (DB::table('passkeys')->where('user_id', $u->id)->count() >= 10) {
            return $this->fail(422, 'You already have 10 passkeys. Remove one first.');
        }
        $wa = $this->webauthn();
        $exclude = DB::table('passkeys')->where('user_id', $u->id)->pluck('credential_id')->map(fn ($c) => ByteBuffer::fromBase64Url($c))->all();
        $args = $wa->getCreateArgs($u->id, $u->email, self::nameOf($u), 60, 'required', true, null, $exclude);
        unset($args->publicKey->extensions);
        $challengeId = $this->putChallenge('register', $wa->getChallenge()->getBinaryString(), $u->id);
        return response()->json(['challengeId' => $challengeId, 'options' => json_decode(json_encode($args->publicKey), true)]);
    }

    public function register(Request $request): JsonResponse
    {
        $u = $this->me($request);
        $challenge = $this->takeChallenge($request->input('challengeId'), 'register', $u->id);
        $resp = $request->input('response.response', []);
        if ($challenge === null) {
            return $this->fail(422, 'That took too long. Try again.');
        }
        try {
            $data = $this->webauthn()->processCreate(self::bin($resp['clientDataJSON'] ?? null), self::bin($resp['attestationObject'] ?? null), $challenge, true, true, false);
        } catch (\Throwable $e) {
            SecurityEvents::record('passkey_register_failed', $u->id, ['error' => mb_substr($e->getMessage(), 0, 120)]);
            return $this->fail(422, "This device couldn't create a passkey.");
        }
        DB::table('passkeys')->insert([
            'id' => (string) Str::ulid(), 'user_id' => $u->id, 'credential_id' => self::b64u($data->credentialId), 'public_key' => $data->credentialPublicKey,
            'sign_count' => (int) ($data->signatureCounter ?? 0), 'label' => Clean::text($request->input('label'), 60) ?: 'Passkey', 'created_at' => now(), 'updated_at' => now(),
        ]);
        SecurityEvents::record('passkey_added', $u->id, [], null, $u->email);
        return response()->json(['ok' => true]);
    }

    public function index(Request $request): JsonResponse
    {
        $rows = DB::table('passkeys')->where('user_id', $this->me($request)->id)->orderBy('created_at')->get();
        return response()->json(['passkeys' => $rows->map(fn ($p) => ['id' => $p->id, 'label' => $p->label, 'createdAtMs' => self::ms($p->created_at), 'lastUsedAtMs' => self::ms($p->last_used_at)])]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $u = $this->me($request);
        $n = Clean::isId($id) ? DB::table('passkeys')->where('id', $id)->where('user_id', $u->id)->delete() : 0;
        if ($n) {
            SecurityEvents::record('passkey_removed', $u->id, [], null, $u->email);
        }
        return $n ? response()->json(['ok' => true]) : $this->fail(404, 'Not found.');
    }

    // ---- sign-in (signed out) -----------------------------------------------------------------------

    public function signInOptions(Request $request): JsonResponse
    {
        $wa = $this->webauthn();
        $args = $wa->getGetArgs([], 60, true, true, true, true, true, true);
        $challengeId = $this->putChallenge('signin', $wa->getChallenge()->getBinaryString());
        return response()->json(['challengeId' => $challengeId, 'options' => json_decode(json_encode($args->publicKey), true)]);
    }

    public function signIn(Request $request): JsonResponse
    {
        if (!$request->hasSession()) {
            return $this->fail(400, 'Sign in from the Voyager app.');
        }
        if (!$request->boolean('agree')) {
            return $this->fail(422, 'Tick to agree before signing in.');
        }
        if (RateLimiter::tooManyAttempts("passkey-ip:{$request->ip()}", 300)) {
            return $this->fail(429, 'Too many attempts. Try again later.');
        }
        RateLimiter::hit("passkey-ip:{$request->ip()}", 60);
        $challenge = $this->takeChallenge($request->input('challengeId'), 'signin');
        $credId = $request->input('response.id');
        $resp = $request->input('response.response', []);
        $key = is_string($credId) && strlen($credId) <= 1400 ? DB::table('passkeys')->where('credential_id', $credId)->first() : null;
        if ($challenge === null || !$key) {
            return $this->fail(422, "This passkey isn't recognised.");
        }
        $user = User::find($key->user_id);
        try {
            if (isset($resp['userHandle']) && $resp['userHandle'] !== '' && self::bin($resp['userHandle']) !== $key->user_id) {
                throw new \RuntimeException('user handle mismatch');
            }
            $wa = $this->webauthn();
            $wa->processGet(self::bin($resp['clientDataJSON'] ?? null), self::bin($resp['authenticatorData'] ?? null), self::bin($resp['signature'] ?? null),
                $key->public_key, $challenge, (int) $key->sign_count ?: null, true, true);
        } catch (\Throwable $e) {
            SecurityEvents::record('passkey_signin_failed', $key->user_id, ['error' => mb_substr($e->getMessage(), 0, 120)], 'refused');
            return $this->fail(422, "This passkey isn't recognised.");
        }
        if (!$user || $user->disabled_at !== null) {
            return $this->fail(403, 'This account is disabled. Contact an administrator.');
        }
        DB::table('passkeys')->where('id', $key->id)->update(['sign_count' => (int) ($wa->getSignatureCounter() ?? 0), 'last_used_at' => now(), 'updated_at' => now()]);
        Agreements::record($user, 'passkey', $request);
        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        return response()->json(['user' => AuthController::sessionView($user->fresh())]);
    }
}
