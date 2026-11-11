<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Minishlink\WebPush\VAPID;

/** Generates the Web Push key pair once. Put the private key in Secrets Manager, never in git. */
class MakeVapidKeys extends Command
{
    protected $signature = 'voyager:vapid';

    protected $description = 'Generate VAPID keys for web push';

    public function handle(): int
    {
        $keys = VAPID::createVapidKeys();
        $this->line('VAPID_PUBLIC_KEY=' . $keys['publicKey']);
        $this->line('VAPID_PRIVATE_KEY=' . $keys['privateKey']);
        $this->warn('Store the private key in AWS Secrets Manager. Changing keys invalidates every push subscription.');
        return self::SUCCESS;
    }
}
