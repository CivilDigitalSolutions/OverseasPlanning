<?php

namespace Tests\Feature;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Who sees what (SECURITY-PLAN T6/T7, CLAUDE.md rule 1): every trip-scoped endpoint refuses a
 * person who is not on the trip — the cross-trip denial test the rules suite always carried.
 */
class AccessControlTest extends TestCase
{
    /** Every trip-scoped read, as [method, path suffix]. */
    private const TRIP_READS = [
        ['GET', ''], ['GET', 'members'], ['GET', 'items/flights'], ['GET', 'items/hotels'], ['GET', 'items/cars'], ['GET', 'items/assets'],
        ['GET', 'messages'], ['GET', 'attachments'], ['GET', 'requests'], ['GET', 'summaries'], ['GET', 'vaccinations'], ['GET', 'debrief'],
        ['GET', 'finance'], ['GET', 'contacts'], ['GET', 'snapshot'], ['GET', 'read'],
    ];

    public function test_people_on_another_trip_are_refused_everything(): void
    {
        $ann = $this->person('Ann Lead');
        $eve = $this->person('Eve Other');
        $mine = $this->trip($ann);
        $this->trip($eve); // Eve is on a different trip

        foreach (self::TRIP_READS as [$m, $p]) {
            $this->actingAs($eve)->json($m, $this->api("trips/{$mine}/{$p}"))->assertNotFound();
            $this->actingAs($ann)->json($m, $this->api("trips/{$mine}/{$p}"))->assertOk();
        }
        $writes = [
            ['PATCH', '', ['name' => 'Hijack']], ['PUT', 'roles', ['roles' => []]], ['POST', 'access', ['email' => 'x@example.org']],
            ['POST', 'items/hotels', ['values' => ['name' => 'H']]], ['POST', 'messages', ['text' => 'hi']], ['POST', 'requests', ['kind' => 'cash', 'title' => 't']],
            ['PUT', 'summaries/spc', ['text' => 's']], ['PUT', 'vaccinations', ['vaccines' => []]], ['PUT', 'debrief', ['injuryRefs' => []]],
            ['POST', 'finance', ['description' => 'd', 'amount' => 1, 'currency' => 'GBP']], ['PUT', 'finance-note', ['text' => 'n']],
        ];
        foreach ($writes as [$m, $p, $body]) {
            $this->actingAs($eve)->json($m, $this->api("trips/{$mine}/{$p}"), $body)->assertNotFound();
        }
        $this->actingAs($eve)->post($this->api("trips/{$mine}/attachments"), ['file' => UploadedFile::fake()->create('a.pdf', 10)])->assertNotFound();
        $this->assertSame('Trip ' . substr($mine, -4), DB::table('trips')->where('id', $mine)->value('name'));
    }

    public function test_trip_list_only_shows_my_trips_but_host_sees_all(): void
    {
        $ann = $this->person('Ann Lead');
        $eve = $this->person('Eve Other');
        $host = $this->person('Hal Host', ['host']);
        $a = $this->trip($ann);
        $e = $this->trip($eve);
        $this->actingAs($ann)->getJson($this->api('trips'))->assertJsonCount(1, 'trips')->assertJsonPath('trips.0.id', $a);
        $ids = collect($this->actingAs($host)->getJson($this->api('trips'))->json('trips'))->pluck('id')->all();
        $this->assertEqualsCanonicalizing([$a, $e], $ids);
    }

    public function test_unverified_accounts_see_nothing(): void
    {
        $u = $this->person('Una Verified', [], false);
        $this->actingAs($u)->getJson($this->api('trips'))->assertForbidden()->assertJsonPath('code', 'unverified');
    }

    public function test_controller_sees_live_trips_basic_details_and_messages_only(): void
    {
        $ann = $this->person('Ann Lead');
        $ctl = $this->person('Cal Controller', ['controller']);
        $live = $this->trip($ann, [], ['start_date' => now()->addDays(3)->toDateString(), 'end_date' => now()->addDays(9)->toDateString()]);
        $later = $this->trip($ann);

        $this->actingAs($ctl)->getJson($this->api('live-trips'))->assertJsonCount(1, 'trips')->assertJsonPath('trips.0.id', $live);
        $this->actingAs($ctl)->getJson($this->api("trips/{$live}"))->assertOk()->assertJsonMissingPath('trip.cyberRationale');
        $this->actingAs($ctl)->postJson($this->api("trips/{$live}/messages"), ['text' => 'Checking in'])->assertCreated();
        $this->actingAs($ctl)->getJson($this->api("trips/{$live}/items/flights"))->assertNotFound();
        $this->actingAs($ctl)->getJson($this->api("trips/{$later}"))->assertNotFound();
        $this->actingAs($ann)->getJson($this->api('live-trips'))->assertForbidden();
    }

    public function test_booking_on_a_flight_grants_access_and_unbooking_removes_it(): void
    {
        $ann = $this->person('Ann Lead');
        $bob = $this->person('Bob Passenger');
        $trip = $this->trip($ann);
        $flight = ['flightStatus' => 'Planning', 'flightType' => 'Outbound', 'flightNumber' => 'BA117', 'from' => 'LHR', 'to' => 'JFK', 'corporateTravel' => 'Yes', 'valueForMoney' => 'Yes'];

        $id = $this->actingAs($ann)->postJson($this->api("trips/{$trip}/items/flights"), ['values' => $flight + ['passengers' => [['name' => 'Bob', 'travelClass' => 'Economy', 'uid' => $bob->id, 'email' => $bob->email]]]])->assertCreated()->json('id');
        $this->actingAs($bob)->getJson($this->api("trips/{$trip}"))->assertOk();
        $this->assertSame(1, DB::table('app_notifications')->where('user_id', $bob->id)->where('type', 'flight_added')->count());
        $this->assertSame(0, DB::table('app_notifications')->where('user_id', $bob->id)->where('type', 'trip_added')->count());

        $this->actingAs($ann)->putJson($this->api("trips/{$trip}/items/flights/{$id}"), ['values' => $flight])->assertOk();
        $this->actingAs($bob)->getJson($this->api("trips/{$trip}"))->assertNotFound();
    }

    public function test_an_unconfirmed_account_cannot_be_given_access_by_uid(): void
    {
        $ann = $this->person('Ann Lead');
        $una = $this->person('Una Verified', [], false);
        $trip = $this->trip($ann);
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/access"), ['uid' => $una->id])->assertNotFound();
        $flight = ['flightStatus' => 'Planning', 'flightType' => 'Outbound', 'flightNumber' => 'BA1', 'from' => 'A', 'to' => 'B', 'corporateTravel' => 'No', 'valueForMoney' => 'No'];
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/items/flights"), ['values' => $flight + ['passengers' => [['name' => 'Una', 'travelClass' => 'Economy', 'uid' => $una->id]]]])->assertCreated();
        $this->assertFalse(DB::table('trip_members')->where('trip_id', $trip)->where('user_id', $una->id)->exists());
    }

    public function test_pending_email_access_is_claimed_when_the_address_is_confirmed(): void
    {
        $ann = $this->person('Ann Lead');
        $trip = $this->trip($ann);
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/access"), ['email' => 'new.person@example.org'])->assertJsonPath('status', 'pending');
        $new = $this->person('New Person');
        $this->actingAs($new)->postJson($this->api('me/sync-pending'))->assertJsonPath('added', 1);
        $this->actingAs($new)->getJson($this->api("trips/{$trip}"))->assertOk();
    }

    public function test_only_host_or_team_leader_moves_status(): void
    {
        $ann = $this->person('Ann Requester');
        $tl = $this->person('Tia Leader');
        $trip = $this->trip($ann, ['teamLeader' => $tl]);
        $this->actingAs($ann)->patchJson($this->api("trips/{$trip}"), ['status' => 'archived'])->assertForbidden();
        $this->actingAs($ann)->patchJson($this->api("trips/{$trip}"), ['location' => 'Bergen'])->assertOk();
        $this->actingAs($tl)->patchJson($this->api("trips/{$trip}"), ['status' => 'archived'])->assertOk();
        $this->actingAs($ann)->patchJson($this->api("trips/{$trip}"), ['memberUids' => [$ann->id]])->assertUnprocessable();
    }

    public function test_attachments_round_trip_and_are_private(): void
    {
        $ann = $this->person('Ann Lead');
        $eve = $this->person('Eve Other');
        $trip = $this->trip($ann);
        $this->actingAs($ann)->post($this->api("trips/{$trip}/attachments"), ['file' => UploadedFile::fake()->createWithContent('itinerary.txt', 'secret plan')])->assertCreated();
        $att = DB::table('attachments')->where('trip_id', $trip)->first();
        $this->assertStringNotContainsString('itinerary', $att->disk_path);
        $res = $this->actingAs($ann)->get($this->api("trips/{$trip}/attachments/{$att->id}/download"))->assertOk();
        $this->assertSame('secret plan', $res->streamedContent());
        $this->actingAs($eve)->get($this->api("trips/{$trip}/attachments/{$att->id}/download"))->assertNotFound();
    }

    public function test_anyone_on_the_trip_adds_and_removes_additional_access_but_not_roles(): void
    {
        $ann = $this->person('Ann Requester');
        $tia = $this->person('Tia Leader');
        $xan = $this->person('Xan Extra');
        $eve = $this->person('Eve Outsider');
        $trip = $this->trip($ann, ['teamLeader' => $tia]);

        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/access"), ['uid' => $xan->id])->assertJsonPath('status', 'added');
        $this->actingAs($xan)->getJson($this->api("trips/{$trip}"))->assertOk();
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/access"), ['uid' => $tia->id])->assertJsonPath('status', 'already');

        // An outsider cannot remove anyone (cross-trip denial).
        $this->actingAs($eve)->postJson($this->api("trips/{$trip}/access/remove"), ['uid' => $xan->id])->assertNotFound();
        // A member (not HOST) removes additional access.
        $this->actingAs($tia)->postJson($this->api("trips/{$trip}/access/remove"), ['uid' => $xan->id])->assertOk()->assertJsonPath('stillOnTripAs', []);
        $this->actingAs($xan)->getJson($this->api("trips/{$trip}"))->assertNotFound();
        // A role holder keeps access, and the answer says why.
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/access/remove"), ['uid' => $tia->id])->assertOk()->assertJsonPath('stillOnTripAs', ['Team Leader']);
        $this->actingAs($tia)->getJson($this->api("trips/{$trip}"))->assertOk();
        // Pending email invitations can be cancelled too.
        $this->actingAs($ann)->postJson($this->api("trips/{$trip}/access"), ['email' => 'later@example.org'])->assertJsonPath('status', 'pending');
        $this->actingAs($tia)->postJson($this->api("trips/{$trip}/access/remove"), ['email' => 'later@example.org'])->assertOk();
        $this->assertFalse(DB::table('trip_pending_emails')->where('trip_id', $trip)->exists());
    }
}
