<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Teams (owner, 2026-11-12): a list managed by Administrators; requests must use it. */
class TeamsTest extends TestCase
{
    public function test_only_administrators_manage_teams(): void
    {
        $admin = $this->person('Ada Admin', ['admin']);
        $host = $this->person('Hal Host', ['host']);
        $ann = $this->person('Ann Member');

        $this->actingAs($host)->postJson($this->api('teams'), ['name' => 'T101'])->assertForbidden();
        $this->actingAs($ann)->postJson($this->api('teams'), ['name' => 'T101'])->assertForbidden();
        $id = $this->actingAs($admin)->postJson($this->api('teams'), ['name' => ' T101 '])->assertCreated()->json('id');
        $this->assertSame('T101', DB::table('teams')->where('id', $id)->value('name'));

        $this->actingAs($ann)->putJson($this->api("teams/{$id}"), ['name' => 'T999'])->assertForbidden();
        $this->actingAs($ann)->deleteJson($this->api("teams/{$id}"))->assertForbidden();
        $this->actingAs($ann)->getJson($this->api('teams'))->assertOk()->assertJsonPath('teams.0.name', 'T101');

        $this->actingAs($admin)->putJson($this->api("teams/{$id}"), ['name' => 'T102'])->assertOk();
        $this->actingAs($admin)->deleteJson($this->api("teams/{$id}"))->assertOk();
        $this->assertSame(0, DB::table('teams')->count());
        $this->assertSame(3, DB::table('security_events')->whereIn('type', ['team_added', 'team_renamed', 'team_removed'])->count());
    }

    public function test_names_are_checked_and_unique_ignoring_case(): void
    {
        $admin = $this->person('Ada Admin', ['admin']);
        $this->actingAs($admin)->postJson($this->api('teams'), ['name' => 'T101'])->assertCreated();
        $this->actingAs($admin)->postJson($this->api('teams'), ['name' => 't101'])->assertUnprocessable();
        $this->actingAs($admin)->postJson($this->api('teams'), ['name' => 'T/101'])->assertUnprocessable();
        $this->actingAs($admin)->postJson($this->api('teams'), ['name' => str_repeat('T', 41)])->assertUnprocessable();
    }

    public function test_requests_must_name_a_listed_team_and_trips_keep_removed_teams(): void
    {
        $admin = $this->person('Ada Admin', ['admin']);
        $ann = $this->person('Ann Member');
        $id = $this->actingAs($admin)->postJson($this->api('teams'), ['name' => 'T101'])->json('id');
        $this->actingAs($admin)->postJson($this->api('teams'), ['name' => 'T102']);
        $req = ['location' => 'Oslo', 'startDate' => '2027-01-01', 'endDate' => '2027-01-05'];
        $this->actingAs($ann)->postJson($this->api('trip-requests'), $req + ['teamName' => 'Made Up'])->assertUnprocessable();
        $this->actingAs($ann)->postJson($this->api('trip-requests'), $req + ['teamName' => 'T101'])->assertCreated();

        $trip = $this->trip($ann, [], ['team_name' => 'T101']);
        $this->actingAs($admin)->deleteJson($this->api("teams/{$id}"))->assertOk();
        // Still T101 (removed from the list): other edits work, the team stays.
        $this->actingAs($ann)->patchJson($this->api("trips/{$trip}"), ['teamName' => 'T101', 'location' => 'Bergen'])->assertOk();
        $this->actingAs($ann)->patchJson($this->api("trips/{$trip}"), ['teamName' => 'Made Up'])->assertUnprocessable();
        $this->actingAs($ann)->patchJson($this->api("trips/{$trip}"), ['teamName' => 'T102'])->assertOk();
        $this->assertSame('T102', DB::table('trips')->where('id', $trip)->value('team_name'));
    }
}
