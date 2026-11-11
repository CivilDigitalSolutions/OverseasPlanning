<?php

namespace Tests;

use App\Models\User;
use App\Services\Membership;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Requests from the app's own origin, as the PWA's are (Sanctum stateful domain).
        $this->withHeader('Referer', 'http://localhost/');
    }

    /** A confirmed account with the given role profiles. */
    protected function person(string $name, array $roles = [], bool $verified = true): User
    {
        $u = new User(['name' => $name, 'email' => strtolower(str_replace(' ', '.', $name)) . '@example.org', 'password' => 'correct horse battery']);
        $u->forceFill([
            'email_verified_at' => $verified ? now() : null,
            'is_host' => in_array('host', $roles, true), 'is_controller' => in_array('controller', $roles, true),
            'is_spc' => in_array('spc', $roles, true), 'is_admin' => in_array('admin', $roles, true),
        ])->save();
        return $u;
    }

    /** A trip created directly (as createTrip would), membership computed by the real service. */
    protected function trip(User $requester, array $roles = [], array $overrides = []): string
    {
        $id = (string) Str::ulid();
        $resolved = [];
        foreach ($roles as $k => $u) {
            $resolved[$k] = ['name' => $u->name, 'email' => $u->email, 'uid' => $u->id];
        }
        DB::table('trips')->insert($overrides + [
            'id' => $id, 'name' => 'Trip ' . substr($id, -4), 'team_name' => 'Team', 'location' => 'Oslo', 'start_date' => now()->addDays(60)->toDateString(),
            'end_date' => now()->addDays(65)->toDateString(), 'status' => 'planning', 'cyber_risk' => 'Low', 'cyber_rationale' => 'r', 'country_risk' => 'Low',
            'country_rationale' => 'r', 'roles' => json_encode($resolved, JSON_FORCE_OBJECT), 'requester_id' => $requester->id, 'created_by' => $requester->id,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        Membership::recompute($id);
        return $id;
    }

    protected function api(string $path): string
    {
        return '/api/v1/' . ltrim($path, '/');
    }
}
