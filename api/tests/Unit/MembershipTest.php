<?php

namespace Tests\Unit;

use App\Services\Membership;
use PHPUnit\Framework\TestCase;

class MembershipTest extends TestCase
{
    public function test_reasons_are_merged_and_pending_emails_collected(): void
    {
        $r = Membership::compute(
            ['uid' => 'u1', 'name' => 'Ann', 'email' => 'ann@x.org'],
            ['teamLeader' => ['name' => 'Ann', 'email' => 'ann@x.org', 'uid' => 'u1'], 'spc' => ['name' => 'Sam', 'email' => 'SAM@x.org', 'uid' => null]],
            [['flight' => 'BA 117', 'name' => 'Bob', 'uid' => 'u2']],
            [['uid' => 'u3', 'name' => 'Cat', 'email' => 'cat@x.org']],
            ['Dee@x.org'],
        );
        $this->assertSame(['Requester', 'Team Leader'], $r['members']['u1']['reasons']);
        $this->assertSame(['On flight BA 117'], $r['members']['u2']['reasons']);
        $this->assertSame(['Additional access'], $r['members']['u3']['reasons']);
        $this->assertSame(['dee@x.org', 'sam@x.org'], $r['pending']);
    }
}
