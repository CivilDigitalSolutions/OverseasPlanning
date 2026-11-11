<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\ResetPasswordLink;
use App\Notifications\VerifyEmailLink;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/** Sign-up, sign-in with recorded agreement, email confirmation, reset, lockout (spec §2). */
class AuthTest extends TestCase
{
    public function test_registration_requires_agreement_records_it_and_ignores_role_fields(): void
    {
        Notification::fake();
        $body = ['name' => 'Ann', 'email' => 'Ann@Example.org', 'password' => 'a long enough password'];
        $this->postJson($this->api('auth/register'), $body)->assertUnprocessable();
        $this->postJson($this->api('auth/register'), $body + ['agree' => true, 'is_admin' => true, 'is_host' => true])->assertCreated()
            ->assertJsonPath('user.emailVerified', false)->assertJsonPath('user.isAdmin', false)->assertJsonPath('user.isHost', false);
        $u = User::where('email', 'ann@example.org')->firstOrFail();
        $this->assertSame(1, DB::table('agreements')->where('user_id', $u->id)->where('method', 'signup')->count());
        Notification::assertSentTo($u, VerifyEmailLink::class);
    }

    public function test_short_passwords_are_refused(): void
    {
        $this->postJson($this->api('auth/register'), ['name' => 'A', 'email' => 'a@example.org', 'password' => 'short', 'agree' => true])->assertUnprocessable();
    }

    public function test_login_needs_agreement_and_gives_one_answer_for_bad_email_or_password(): void
    {
        $ann = $this->person('Ann Lead');
        $this->postJson($this->api('auth/login'), ['email' => $ann->email, 'password' => 'correct horse battery'])->assertUnprocessable();
        $a = $this->postJson($this->api('auth/login'), ['email' => $ann->email, 'password' => 'wrong', 'agree' => true])->assertUnprocessable()->json('message');
        $b = $this->postJson($this->api('auth/login'), ['email' => 'nobody@example.org', 'password' => 'wrong', 'agree' => true])->assertUnprocessable()->json('message');
        $this->assertSame($a, $b);
        $this->postJson($this->api('auth/login'), ['email' => $ann->email, 'password' => 'correct horse battery', 'agree' => true])->assertOk();
        $this->assertSame(1, DB::table('agreements')->where('user_id', $ann->id)->where('method', 'password')->count());
    }

    public function test_five_failures_lock_the_email_and_raise_a_security_event(): void
    {
        $ann = $this->person('Ann Lead');
        for ($i = 0; $i < 5; $i++) {
            $this->postJson($this->api('auth/login'), ['email' => $ann->email, 'password' => 'wrong', 'agree' => true]);
        }
        $this->postJson($this->api('auth/login'), ['email' => $ann->email, 'password' => 'correct horse battery', 'agree' => true])->assertStatus(429);
        $this->assertTrue(DB::table('security_events')->where('type', 'login_locked')->exists());
    }

    public function test_disabled_accounts_cannot_sign_in_or_keep_using_a_session(): void
    {
        $ann = $this->person('Ann Lead');
        $ann->forceFill(['disabled_at' => now()])->save();
        $this->postJson($this->api('auth/login'), ['email' => $ann->email, 'password' => 'correct horse battery', 'agree' => true])->assertForbidden();
        $this->actingAs($ann)->getJson($this->api('trips'))->assertForbidden()->assertJsonPath('code', 'disabled');
    }

    public function test_email_link_confirms_without_a_session_and_rejects_tampering(): void
    {
        $u = $this->person('Una Verified', [], false);
        $mail = (new VerifyEmailLink())->toMail($u);
        parse_str(parse_url($mail->actionUrl, PHP_URL_QUERY), $q);
        $this->postJson($this->api('auth/verify-email'), ['id' => $q['id'], 'hash' => $q['hash'], 'expires' => $q['expires'], 'signature' => 'x' . substr($q['signature'], 1)])->assertUnprocessable();
        $this->postJson($this->api('auth/verify-email'), ['id' => $q['id'], 'hash' => $q['hash'], 'expires' => $q['expires'], 'signature' => $q['signature']])->assertOk();
        $this->assertTrue($u->fresh()->isVerified());
    }

    public function test_password_reset_flow_and_no_account_discovery(): void
    {
        Notification::fake();
        $ann = $this->person('Ann Lead');
        $this->postJson($this->api('auth/forgot-password'), ['email' => 'nobody@example.org'])->assertOk();
        $this->postJson($this->api('auth/forgot-password'), ['email' => $ann->email])->assertOk();
        $token = null;
        Notification::assertSentTo($ann, ResetPasswordLink::class, function ($n) use (&$token, $ann) {
            parse_str(parse_url($n->toMail($ann)->actionUrl, PHP_URL_QUERY), $q);
            $token = $q['token'];
            return true;
        });
        $this->postJson($this->api('auth/reset-password/check'), ['email' => $ann->email, 'token' => $token])->assertOk();
        $this->postJson($this->api('auth/reset-password'), ['email' => $ann->email, 'token' => $token, 'password' => 'another long password'])->assertOk();
        $this->postJson($this->api('auth/login'), ['email' => $ann->email, 'password' => 'another long password', 'agree' => true])->assertOk();
        $this->postJson($this->api('auth/reset-password'), ['email' => $ann->email, 'token' => $token, 'password' => 'third long password!'])->assertUnprocessable();
    }

    private function pollAfter(int $idleSeconds, int $sessionAgeSeconds, bool $poll = true): \Illuminate\Testing\TestResponse
    {
        config(['security.session.idle_minutes' => 30, 'security.session.absolute_hours' => 12]);
        $now = time();
        $req = $this->actingAs($this->person('Ann Lead'))->withSession(['voyager.active_at' => $now - $idleSeconds, 'voyager.started_at' => $now - $sessionAgeSeconds]);
        return ($poll ? $req->withHeader('X-Background-Poll', '1') : $req)->getJson($this->api('trips'));
    }

    public function test_a_background_poll_is_served_but_does_not_refresh_the_idle_clock(): void
    {
        $this->pollAfter(1200, 3600)->assertOk();
        $this->assertLessThanOrEqual(time() - 1200, session('voyager.active_at'));
    }

    public function test_polls_do_not_keep_an_idle_session_alive(): void
    {
        $this->pollAfter(2100, 3600)->assertUnauthorized()->assertJsonPath('code', 'session_expired');
    }

    public function test_sessions_end_after_the_absolute_lifetime(): void
    {
        $this->pollAfter(10, 13 * 3600, false)->assertUnauthorized();
    }

    public function test_sign_in_without_the_app_origin_is_refused(): void
    {
        $ann = $this->person('Ann Lead');
        $this->withHeaders(['Referer' => ''])->postJson($this->api('auth/login'), ['email' => $ann->email, 'password' => 'correct horse battery', 'agree' => true])->assertStatus(400);
    }
}
