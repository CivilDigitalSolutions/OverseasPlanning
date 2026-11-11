<?php

namespace Tests\Feature;

use Tests\TestCase;

/** Passkey ceremonies: user verification required, discoverable keys, single-use typed challenges. */
class PasskeyTest extends TestCase
{
    public function test_sign_in_options_require_user_verification(): void
    {
        $r = $this->postJson($this->api('auth/passkey/options'))->assertOk();
        $this->assertSame('required', $r->json('options.userVerification'));
        $this->assertNotEmpty($r->json('challengeId'));
    }

    public function test_sign_in_needs_agreement_a_live_challenge_and_a_known_key(): void
    {
        $challengeId = $this->postJson($this->api('auth/passkey/options'))->json('challengeId');
        $body = ['challengeId' => $challengeId, 'response' => ['id' => 'unknown', 'response' => []]];
        $this->postJson($this->api('auth/passkey'), $body)->assertUnprocessable();
        $this->postJson($this->api('auth/passkey'), $body + ['agree' => true])->assertUnprocessable();
        // Challenges are single-use and bound to their ceremony.
        $this->postJson($this->api('auth/passkey'), $body + ['agree' => true])->assertUnprocessable();
    }

    public function test_registration_needs_a_confirmed_session_and_requires_a_discoverable_verified_key(): void
    {
        $this->postJson($this->api('passkeys/options'))->assertUnauthorized();
        $r = $this->actingAs($this->person('Ann Lead'))->postJson($this->api('passkeys/options'))->assertOk();
        $this->assertSame('required', $r->json('options.authenticatorSelection.userVerification'));
        $this->assertSame('required', $r->json('options.authenticatorSelection.residentKey'));
        // A sign-in challenge cannot be used to register.
        $signin = $this->postJson($this->api('auth/passkey/options'))->json('challengeId');
        $this->actingAs($this->person('Bob Member'))->postJson($this->api('passkeys'), ['challengeId' => $signin, 'response' => ['response' => []]])->assertUnprocessable();
    }
}
