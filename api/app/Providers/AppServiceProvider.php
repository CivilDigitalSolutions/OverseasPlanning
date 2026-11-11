<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
    }

    /**
     * Route rate limits. Keyed on the signed-in user wherever possible: Zscaler sends many people
     * from few IP addresses, so per-IP limits are deliberately generous (plan review item 1).
     */
    public function boot(): void
    {
        // Session cookies only: bearer tokens are never issued, so never even look for one.
        Sanctum::getAccessTokenFromRequestUsing(fn () => null);

        RateLimiter::for('auth', fn (Request $r) => Limit::perMinute(300)->by('ip:' . $r->ip()));
        // Polling (MIGRATION-PLAN §3) on a busy trip screen is ~1 request/second.
        RateLimiter::for('app', fn (Request $r) => Limit::perMinute(600)->by('user:' . ($r->user()?->getAuthIdentifier() ?? $r->ip())));
        RateLimiter::for('messages', fn (Request $r) => Limit::perMinute(30)->by('msg:' . ($r->user()?->getAuthIdentifier() ?? $r->ip())));
        RateLimiter::for('uploads', fn (Request $r) => Limit::perHour(60)->by('up:' . ($r->user()?->getAuthIdentifier() ?? $r->ip())));
    }
}
