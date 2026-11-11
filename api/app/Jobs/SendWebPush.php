<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

/**
 * Standard Web Push (VAPID) to every subscribed device of the given people. Runs on the queue so
 * a slow push service never delays a request. Subscriptions the push service reports as gone
 * (404/410) are deleted. Does nothing until VAPID keys are configured.
 */
class SendWebPush implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 2;

    public function __construct(public array $uids, public string $title, public string $link, public string $type)
    {
    }

    public function handle(): void
    {
        $public = (string) config('services.webpush.public_key');
        $private = (string) config('services.webpush.private_key');
        if ($public === '' || $private === '' || !class_exists(WebPush::class)) {
            return;
        }
        $subs = DB::table('push_subscriptions')->whereIn('user_id', $this->uids)->get();
        if ($subs->isEmpty()) {
            return;
        }
        $push = new WebPush(['VAPID' => ['subject' => (string) config('services.webpush.subject'), 'publicKey' => $public, 'privateKey' => $private]]);
        $payload = json_encode(['title' => $this->title, 'body' => 'Open Voyager Trip Manager to read it.', 'link' => $this->link, 'tag' => $this->type]);
        foreach ($subs as $s) {
            $push->queueNotification(Subscription::create([
                'endpoint' => $s->endpoint, 'publicKey' => $s->p256dh, 'authToken' => $s->auth, 'contentEncoding' => 'aes128gcm',
            ]), $payload, ['TTL' => 3600, 'urgency' => 'normal']);
        }
        foreach ($push->flush() as $report) {
            if ($report->isSubscriptionExpired()) {
                DB::table('push_subscriptions')->where('endpoint_hash', hash('sha256', $report->getEndpoint()))->delete();
            } elseif (!$report->isSuccess()) {
                Log::warning('web push failed', ['reason' => mb_substr($report->getReason(), 0, 200)]);
            }
        }
    }
}
