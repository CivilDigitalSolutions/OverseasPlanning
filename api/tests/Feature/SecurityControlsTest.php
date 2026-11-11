<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Runtime protection, headers, append-only records, encryption, administrator controls. */
class SecurityControlsTest extends TestCase
{
    public function test_security_headers_and_no_store_on_api_responses(): void
    {
        $this->getJson($this->api('auth/session'))->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff')->assertHeader('X-Frame-Options', 'DENY')
            ->assertHeader('Referrer-Policy', 'no-referrer')->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('Content-Security-Policy');
    }

    public function test_request_guard_refuses_malformed_input(): void
    {
        $ann = $this->person('Ann Lead');
        $this->actingAs($ann)->call('POST', $this->api('trip-requests'), [], [], [], ['CONTENT_TYPE' => 'text/plain'], 'teamName=x')->assertStatus(415);
        $deep = str_repeat('{"a":', 20) . '1' . str_repeat('}', 20);
        $this->actingAs($ann)->call('POST', $this->api('trip-requests'), [], [], [], ['CONTENT_TYPE' => 'application/json'], $deep)->assertStatus(400);
        $this->actingAs($ann)->call('POST', $this->api('trip-requests'), [], [], [], ['CONTENT_TYPE' => 'application/json'], '{"teamName":"a\u0000b"}')->assertStatus(400);
        $this->assertTrue(DB::table('security_events')->where('type', 'request_refused')->exists());
    }

    public function test_bearer_tokens_are_ignored(): void
    {
        $this->withHeader('Authorization', 'Bearer 1|abc')->getJson($this->api('trips'))->assertUnauthorized();
    }

    public function test_audit_tables_are_append_only_in_the_database(): void
    {
        $ann = $this->person('Ann Lead');
        $this->postJson($this->api('auth/login'), ['email' => $ann->email, 'password' => 'correct horse battery', 'agree' => true])->assertOk();
        DB::table('role_changes')->insert(['id' => (string) \Illuminate\Support\Str::ulid(), 'user_id' => $ann->id, 'changes' => '{}', 'by_user_id' => $ann->id]);
        \App\Security\SecurityEvents::record('test_event', $ann->id);
        $this->assertGreaterThan(0, DB::table('agreements')->count());
        $this->assertGreaterThan(0, DB::table('audit_logs')->count());
        $attempts = [
            fn () => DB::table('agreements')->update(['ip' => '1.2.3.4']),
            fn () => DB::table('agreements')->delete(),
            fn () => DB::table('audit_logs')->update(['ip' => '1.2.3.4']),
            fn () => DB::table('role_changes')->delete(),
            fn () => DB::table('security_events')->update(['type' => 'x']),
        ];
        foreach ($attempts as $i => $attempt) {
            try {
                DB::transaction($attempt); // savepoint, so one refusal does not abort the test transaction
                $this->fail("attempt {$i} was accepted");
            } catch (\Illuminate\Database\QueryException $e) {
                $this->assertStringContainsString('append-only', $e->getMessage());
            }
        }
    }

    public function test_health_and_welfare_data_are_encrypted_at_rest_and_scoped(): void
    {
        $ann = $this->person('Ann Requester');
        $tl = $this->person('Tia Leader');
        $bob = $this->person('Bob Member');
        $trip = $this->trip($ann, ['teamLeader' => $tl, 'officeManager' => $bob]);
        $this->actingAs($bob)->putJson($this->api("trips/{$trip}/vaccinations"), ['vaccines' => [['name' => 'Yellow fever', 'date' => '2025-01-01']], 'notes' => 'Allergic', 'declared' => true])->assertOk();
        $this->actingAs($ann)->putJson($this->api("trips/{$trip}/debrief"), ['welfareConcerns' => 'Stress', 'injuryRefs' => ['INJ-1']])->assertOk();

        $raw = json_encode(DB::table('vaccinations')->get()) . json_encode(DB::table('debriefs')->get());
        foreach (['Yellow fever', 'Allergic', 'Stress', 'INJ-1'] as $plain) {
            $this->assertStringNotContainsString($plain, $raw);
        }
        $this->actingAs($ann)->getJson($this->api("trips/{$trip}/vaccinations?all=1"))->assertJsonCount(0, 'vaccinations');
        $this->actingAs($tl)->getJson($this->api("trips/{$trip}/vaccinations?all=1"))->assertJsonPath('vaccinations.0.notes', 'Allergic');
        $this->actingAs($bob)->getJson($this->api("trips/{$trip}/debrief"))->assertJsonPath('debrief.welfareConcerns', 'Stress');
    }

    public function test_only_administrators_change_roles_and_every_change_is_logged(): void
    {
        $admin = $this->person('Ada Admin', ['admin']);
        $ann = $this->person('Ann Lead');
        $this->actingAs($ann)->putJson($this->api("admin/accounts/{$ann->id}/roles"), ['roles' => ['host' => true]])->assertForbidden();
        $this->actingAs($ann)->getJson($this->api('admin/accounts'))->assertForbidden();
        $this->actingAs($admin)->putJson($this->api("admin/accounts/{$ann->id}/roles"), ['roles' => ['host' => true]])->assertOk();
        $this->assertTrue($ann->fresh()->is_host);
        $this->assertSame(1, DB::table('role_changes')->where('user_id', $ann->id)->count());
        $this->actingAs($admin)->putJson($this->api("admin/accounts/{$admin->id}/roles"), ['roles' => []])->assertUnprocessable();
    }

    public function test_admin_created_accounts_get_an_emailed_link_not_one_shown_to_the_admin(): void
    {
        \Illuminate\Support\Facades\Notification::fake();
        $admin = $this->person('Ada Admin', ['admin']);
        $this->actingAs($admin)->postJson($this->api('admin/accounts'), ['name' => 'New Hire', 'email' => 'new.hire@example.org', 'roles' => ['spc' => true]])
            ->assertCreated()->assertJsonPath('setupLink', '');
        $u = \App\Models\User::where('email', 'new.hire@example.org')->firstOrFail();
        $this->assertTrue($u->is_spc);
        $this->assertNull($u->password);
        \Illuminate\Support\Facades\Notification::assertSentTo($u, \App\Notifications\ResetPasswordLink::class);
    }

    public function test_deleting_an_account_removes_its_access_but_keeps_the_audit_trail(): void
    {
        $admin = $this->person('Ada Admin', ['admin']);
        $ann = $this->person('Ann Requester');
        $bob = $this->person('Bob Leader');
        $trip = $this->trip($ann, ['teamLeader' => $bob]);
        \App\Services\Agreements::record($bob, 'password', request());
        $this->actingAs($admin)->deleteJson($this->api("admin/accounts/{$bob->id}"))->assertOk();
        $this->assertFalse(DB::table('trip_members')->where('user_id', $bob->id)->exists());
        $this->assertSame(1, DB::table('agreements')->where('user_id', $bob->id)->count());
        $this->actingAs($ann)->getJson($this->api("trips/{$trip}"))->assertOk()->assertJsonPath('trip.roles.teamLeader.uid', null);
    }

    public function test_anomaly_detector_alerts_and_in_protect_mode_disables_the_account(): void
    {
        config(['security.rasp.mode' => 'protect', 'security.rasp.max_denials' => 3]);
        $eve = $this->person('Eve Prober');
        $other = $this->person('Ann Lead');
        $trips = [$this->trip($other), $this->trip($other), $this->trip($other)];
        // The same refused trip polled repeatedly is NOT counted three times (plan review item 5).
        for ($i = 0; $i < 5; $i++) {
            $this->actingAs($eve)->getJson($this->api("trips/{$trips[0]}"))->assertNotFound();
        }
        $this->assertNull($eve->fresh()->disabled_at);
        foreach ($trips as $t) {
            $this->actingAs($eve)->getJson($this->api("trips/{$t}"));
        }
        $this->assertNotNull($eve->fresh()->disabled_at);
        $this->assertTrue(DB::table('security_events')->where('type', 'access_denials_threshold')->where('action_taken', 'account_disabled')->exists());
    }

    public function test_push_subscription_endpoints_are_restricted_to_real_push_services(): void
    {
        $ann = $this->person('Ann Lead');
        $keys = ['p256dh' => 'BExample', 'auth' => 'abc'];
        $this->actingAs($ann)->postJson($this->api('push/subscriptions'), ['endpoint' => 'https://169.254.169.254/latest/meta-data', 'keys' => $keys])->assertUnprocessable();
        $this->actingAs($ann)->postJson($this->api('push/subscriptions'), ['endpoint' => 'https://evil.example/fcm.googleapis.com', 'keys' => $keys])->assertUnprocessable();
        $this->actingAs($ann)->postJson($this->api('push/subscriptions'), ['endpoint' => 'https://fcm.googleapis.com/fcm/send/abc', 'keys' => $keys])->assertOk();
    }
}
