<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** SPC outstanding work (owner, 2026-11-12): counts, notifications and reminders. */
class SpcQueueTest extends TestCase
{
    private const FLIGHT = ['flightStatus' => 'Planning', 'flightType' => 'Outbound', 'flightNumber' => 'BA1', 'from' => 'A', 'to' => 'B', 'corporateTravel' => 'No', 'valueForMoney' => 'No'];

    private function spcNotes(string $uid): int
    {
        return DB::table('app_notifications')->where('user_id', $uid)->where('type', 'spc_pending')->count();
    }

    public function test_new_requests_and_flights_notify_the_trips_spcs_and_show_as_counts(): void
    {
        $ann = $this->person('Ann Leader');
        $sam = $this->person('Sam Named');
        $pat = $this->person('Pat Profile', ['spc']);
        $far = $this->person('Fay Elsewhere', ['spc']); // SPC profile but not on this trip
        $trip = $this->trip($ann, ['spc' => $sam, 'intelWorker' => $pat]);

        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/requests"), ['kind' => 'taxi', 'title' => 'Airport'])->assertCreated();
        $fid = $this->actingAs($ann)->postJson($this->api("trips/{$trip}/items/flights"), ['values' => self::FLIGHT])->json('id');
        $this->assertSame(2, $this->spcNotes($sam->id));
        $this->assertSame(2, $this->spcNotes($pat->id));
        $this->assertSame(0, $this->spcNotes($far->id));
        $this->assertSame(0, $this->spcNotes($ann->id));

        $this->actingAs($sam)->getJson($this->api('trips'))->assertJsonPath('trips.0.pendingRequests', 1)->assertJsonPath('trips.0.pendingFlights', 1);
        $this->actingAs($sam)->postJson($this->api("trips/{$trip}/flights/{$fid}/decision"), ['decision' => 'approved', 'rationale' => 'ok'])->assertOk();
        $this->actingAs($sam)->getJson($this->api("trips/{$trip}"))->assertJsonPath('trip.pendingFlights', 0);

        // Editing the decided flight needs the SPC again — and says so.
        $this->actingAs($ann)->putJson($this->api("trips/{$trip}/items/flights/{$fid}"), ['values' => self::FLIGHT + ['airline' => 'BA']])->assertOk();
        $this->assertSame(3, $this->spcNotes($sam->id));
        $this->actingAs($sam)->getJson($this->api("trips/{$trip}"))->assertJsonPath('trip.pendingFlights', 1);
    }

    public function test_anyone_on_the_trip_can_remind_the_spc_but_not_outsiders_and_not_endlessly(): void
    {
        $ann = $this->person('Ann Leader');
        $sam = $this->person('Sam Named');
        $eve = $this->person('Eve Outsider');
        $trip = $this->trip($ann, ['spc' => $sam]);
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/remind-spc"))->assertJsonPath('notified', 0); // nothing pending
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/requests"), ['kind' => 'cash', 'title' => 'Float', 'amount' => 50, 'currency' => 'EUR']);
        $this->actingAs($eve)->postJson($this->api("trips/{$trip}/remind-spc"))->assertNotFound();
        for ($i = 0; $i < 2; $i++) {
            $this->actingAs($ann)->postJson($this->api("trips/{$trip}/remind-spc"))->assertJsonPath('notified', 1);
        }
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/remind-spc"))->assertStatus(429);
        $this->assertSame(2, DB::table('app_notifications')->where('user_id', $sam->id)->where('title', 'Reminder: awaiting your approval')->where('body', 'like', '1 request — %')->count());
    }

    public function test_recent_contacts_are_mine_newest_first_at_most_five(): void
    {
        $ann = $this->person('Ann Leader');
        $bob = $this->person('Bob Other');
        $trip = $this->trip($ann);
        $ids = [];
        for ($i = 1; $i <= 6; $i++) {
            $ids[] = $this->actingAs($ann)->postJson($this->api('contacts'), ['name' => "Contact {$i}"])->json('id');
        }
        foreach ($ids as $i => $id) {
            $this->travel(1)->minutes();
            $this->actingAs($ann)->putJson($this->api("trips/{$trip}/contacts/{$id}"), ['tripRole' => "r{$i}"])->assertOk();
        }
        $this->actingAs($ann)->getJson($this->api('contacts/recent'))->assertJsonPath('ids', array_reverse(array_slice($ids, 1)));
        $this->actingAs($bob)->getJson($this->api('contacts/recent'))->assertJsonPath('ids', []);
    }
}
