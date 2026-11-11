<?php

namespace App\Http\Middleware;

use App\Security\SecurityEvents;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * First line of in-app runtime protection (SECURITY-PLAN §5): gives every request an id, and
 * refuses malformed input before any controller sees it — oversized bodies, writes that are not
 * JSON (except the one multipart upload route), JSON nested too deeply, and NUL bytes.
 */
class RequestGuard
{
    private const MAX_JSON_BYTES = 256 * 1024;
    private const MAX_DEPTH = 8;

    public function handle(Request $request, Closure $next): Response
    {
        $id = (string) Str::ulid();
        $request->attributes->set('request_id', $id);

        if (in_array($request->getMethod(), ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            $isUpload = $request->routeIs('attachments.store') || str_ends_with($request->path(), '/attachments');
            $type = (string) $request->headers->get('Content-Type', '');
            $body = $request->getContent();
            if (!$isUpload) {
                if ($body !== '' && !str_starts_with($type, 'application/json')) {
                    return $this->refuse($request, 415, 'unsupported_content_type');
                }
                if (strlen($body) > self::MAX_JSON_BYTES) {
                    return $this->refuse($request, 413, 'body_too_large');
                }
                if (str_contains($body, '\u0000') || str_contains($body, "\0")) {
                    return $this->refuse($request, 400, 'nul_byte');
                }
                if ($body !== '') {
                    json_decode($body, true, self::MAX_DEPTH);
                    if (json_last_error() !== JSON_ERROR_NONE) {
                        return $this->refuse($request, 400, 'bad_json');
                    }
                }
            }
        }
        $response = $next($request);
        $response->headers->set('X-Request-Id', $id);
        return $response;
    }

    private function refuse(Request $request, int $status, string $why): Response
    {
        SecurityEvents::record('request_refused', $request->user()?->getAuthIdentifier(), ['why' => $why, 'path' => mb_substr($request->path(), 0, 120)], 'blocked');
        return response()->json(['message' => 'Request refused.'], $status);
    }
}
