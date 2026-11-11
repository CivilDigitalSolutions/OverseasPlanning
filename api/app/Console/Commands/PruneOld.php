<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Daily housekeeping: in-app notifications older than 60 days (as the Firebase TTL did). */
class PruneOld extends Command
{
    protected $signature = 'voyager:prune';

    protected $description = 'Delete expired notifications';

    public function handle(): int
    {
        $n = DB::table('app_notifications')->where('created_at', '<', now()->subDays(60))->delete();
        $this->info("Deleted {$n} old notifications.");
        return self::SUCCESS;
    }
}
