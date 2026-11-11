<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ends a session after a period WITHOUT THE PERSON DOING ANYTHING, and after an absolute
 * lifetime (SECURITY-PLAN T10). Background polls send `X-Background-Poll: 1` and do not reset the
 * idle clock — otherwise an open app on a lost phone would stay signed in for ever (plan review 2).
 */
class IdleTimeout
{
    public function handle(Request $request, Closure $next): Response
    {
        // Only cookie (SPA) sessions exist in this app; anything else has no session to time out.
        if (!$request->hasSession()) {
            return $next($request);
        }
        $session = $request->session();
        $now = time();
        if (Auth::guard('web')->check()) {
            $active = (int) $session->get('voyager.active_at', $now);
            $started = (int) $session->get('voyager.started_at', $now);
            $idle = (int) config('security.session.idle_minutes') * 60;
            $absolute = (int) config('security.session.absolute_hours') * 3600;
            if ($now - $active > $idle || $now - $started > $absolute) {
                Auth::guard('web')->logout();
                $session->invalidate();
                $session->regenerateToken();
                return response()->json(['message' => 'Your session has ended. Sign in again.', 'code' => 'session_expired'], 401);
            }
            if ($request->header('X-Background-Poll') !== '1') {
                $session->put('voyager.active_at', $now);
            }
            if (!$session->has('voyager.started_at')) {
                $session->put('voyager.started_at', $now);
            }
        }
        return $next($request);
    }
}
