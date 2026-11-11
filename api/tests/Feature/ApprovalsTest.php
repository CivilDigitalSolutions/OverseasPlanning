<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** SPC-only approvals; approval is final; editing a flight clears its decision (spec §6). */
class ApprovalsTest extends TestCase
{
    public function test_only_an_spc_decides_requests_and_approval_is_final(): void
    {
        $ann = $this->person('Ann Requester');
        $host = $this->person('Hal Host', ['host']);
        $spc = $this->person('Sam Spc');
        $profile = $this->person('Pat Profile', ['spc']);
        $trip = $this->trip($ann, ['spc' => $spc]);
        $id = $this->actingAs($ann)->postJson($this->api("trips/{$trip}/requests"), ['kind' => 'cash', 'title' => 'Float', 'amount' => 200, 'currency' => 'EUR'])->assertCreated()->json('id');

        $this->actingAs($host)->postJson($this->api("trips/{$trip}/requests/{$id}/decide"), ['approve' => true])->assertForbidden();
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/requests/{$id}/decide"), ['approve' => true])->assertForbidden();
        // An SPC profile holder who is NOT on the trip cannot even see it.
        $this->actingAs($profile)->postJson($this->api("trips/{$trip}/requests/{$id}/decide"), ['approve' => true])->assertNotFound();

        $this->actingAs($spc)->postJson($this->api("trips/{$trip}/requests/{$id}/decide"), ['approve' => true, 'note' => 'ok'])->assertOk();
        $this->assertSame('approved', DB::table('tl_requests')->where('id', $id)->value('status'));
        $this->actingAs($spc)->postJson($this->api("trips/{$trip}/requests/{$id}/decide"), ['approve' => false])->assertStatus(409);
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/requests/{$id}/resubmit"))->assertForbidden();
        $this->actingAs($ann)->deleteJson($this->api("trips/{$trip}/requests/{$id}"))->assertForbidden();
    }

    public function test_rejected_request_can_be_resubmitted_by_its_creator_only(): void
    {
        $ann = $this->person('Ann Requester');
        $bob = $this->person('Bob Member');
        $spc = $this->person('Sam Spc');
        $trip = $this->trip($ann, ['spc' => $spc, 'officeManager' => $bob]);
        $id = $this->actingAs($ann)->postJson($this->api("trips/{$trip}/requests"), ['kind' => 'taxi', 'title' => 'Airport'])->json('id');
        $this->actingAs($spc)->postJson($this->api("trips/{$trip}/requests/{$id}/decide"), ['approve' => false, 'note' => 'No'])->assertOk();
        $this->actingAs($bob)->postJson($this->api("trips/{$trip}/requests/{$id}/resubmit"))->assertForbidden();
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/requests/{$id}/resubmit"))->assertOk();
        $this->assertSame('pending', DB::table('tl_requests')->where('id', $id)->value('status'));
    }

    public function test_spc_profile_on_the_trip_can_decide(): void
    {
        $ann = $this->person('Ann Requester');
        $pat = $this->person('Pat Profile', ['spc']);
        $trip = $this->trip($ann, ['intelWorker' => $pat]);
        $id = $this->actingAs($ann)->postJson($this->api("trips/{$trip}/requests"), ['kind' => 'asset', 'title' => 'Phone', 'quantity' => 2])->json('id');
        $this->actingAs($pat)->postJson($this->api("trips/{$trip}/requests/{$id}/decide"), ['approve' => true])->assertOk();
    }

    public function test_flight_decision_is_spc_only_and_any_edit_clears_it(): void
    {
        $ann = $this->person('Ann Requester');
        $spc = $this->person('Sam Spc');
        $trip = $this->trip($ann, ['spc' => $spc]);
        $flight = ['flightStatus' => 'Planning', 'flightType' => 'Outbound', 'flightNumber' => 'BA1', 'from' => 'A', 'to' => 'B', 'corporateTravel' => 'No', 'valueForMoney' => 'No'];
        $id = $this->actingAs($ann)->postJson($this->api("trips/{$trip}/items/flights"), ['values' => $flight])->json('id');

        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/flights/{$id}/decision"), ['decision' => 'approved', 'rationale' => 'x'])->assertForbidden();
        $this->actingAs($spc)->postJson($this->api("trips/{$trip}/flights/{$id}/decision"), ['decision' => 'approved'])->assertUnprocessable();
        $this->actingAs($spc)->postJson($this->api("trips/{$trip}/flights/{$id}/decision"), ['decision' => 'approved', 'rationale' => 'Best value'])->assertOk();
        // A member cannot smuggle a decision in through an ordinary edit, and the edit clears it.
        $this->actingAs($ann)->putJson($this->api("trips/{$trip}/items/flights/{$id}"), ['values' => $flight + ['spcDecision' => 'approved', 'flightNumber' => 'BA2']])->assertOk();
        $this->assertNull(DB::table('trip_items')->where('id', $id)->value('spc_decision'));
    }
}
