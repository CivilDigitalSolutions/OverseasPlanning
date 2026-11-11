<?php

namespace Tests\Unit;

use App\Support\ItemSchemas;
use PHPUnit\Framework\TestCase;

class ItemSchemasTest extends TestCase
{
    private function flight(array $extra = []): array
    {
        return $extra + ['flightStatus' => 'Confirmed', 'flightType' => 'Outbound', 'flightNumber' => 'BA117', 'from' => 'LHR', 'to' => 'JFK', 'corporateTravel' => 'Yes', 'valueForMoney' => 'Yes'];
    }

    public function test_valid_flight_passes(): void
    {
        [$v, $e] = ItemSchemas::check('flights', $this->flight(['cost' => 450.5, 'costCurrency' => 'GBP', 'passengers' => [['name' => 'Ann', 'travelClass' => 'Economy', 'uid' => 'u1', 'email' => 'a@x.org']]]));
        $this->assertSame([], $e);
        $this->assertSame(450.5, $v['cost']);
    }

    public function test_unknown_fields_and_spc_keys_are_refused(): void
    {
        [, $e] = ItemSchemas::check('flights', $this->flight(['spcDecision' => 'approved', 'createdBy' => 'x']));
        $this->assertArrayHasKey('spcDecision', $e);
        $this->assertArrayHasKey('createdBy', $e);
    }

    public function test_bad_values_are_refused(): void
    {
        [, $e] = ItemSchemas::check('flights', $this->flight(['flightStatus' => 'Maybe', 'cost' => -1, 'passengers' => [['name' => 'A', 'travelClass' => 'Cargo']]]));
        $this->assertArrayHasKey('flightStatus', $e);
        $this->assertArrayHasKey('cost', $e);
        $this->assertArrayHasKey('passengers', $e);
        [, $e2] = ItemSchemas::check('hotels', ['name' => 'H', 'checkIn' => '2027-01-05', 'checkOut' => '2027-01-01']);
        $this->assertArrayHasKey('checkOut', $e2);
        [, $e3] = ItemSchemas::check('trips', []);
        $this->assertArrayHasKey('kind', $e3);
    }
}
