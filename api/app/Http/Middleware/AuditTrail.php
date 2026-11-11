<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Append-only audit log of every change and every sensitive read (vaccinations, trip export,
 * attachment downloads, account administration). Stores who, what route, which trip, outcome —
 * never request bodies (they hold personal data).
 */
class AuditTrail
{
    private const SENSITIVE_READS = ['vaccinations.index', 'trips.snapshot', 'attachments.download', 'admin.accounts.index'];

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $route = $request->route();
        $name = $route?->getName() ?? '';
        $write = !in_array($request->getMethod(), ['GET', 'HEAD', 'OPTIONS'], true);
        if ($write || in_array($name, self::SENSITIVE_READS, true)) {
            try {
                DB::table('audit_logs')->insert([
                    'id' => (string) Str::ulid(), 'actor_id' => $request->user()?->getAuthIdentifier(), 'method' => $request->getMethod(),
                    'route' => mb_substr($name ?: $request->path(), 0, 120), 'trip_id' => is_string($route?->parameter('trip')) ? mb_substr($route->parameter('trip'), 0, 26) : null,
                    'status' => $response->getStatusCode(), 'ip' => (string) $request->ip(), 'user_agent' => mb_substr((string) $request->userAgent(), 0, 400),
                    'request_id' => $request->attributes->get('request_id'), 'created_at' => now(),
                ]);
            } catch (\Throwable $e) {
                Log::channel('security')->error('audit write failed', ['error' => $e->getMessage()]);
            }
        }
        return $response;
    }
}
