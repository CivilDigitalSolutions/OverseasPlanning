<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/** A disabled account (administrator action or the anomaly detector) is signed out at once. */
class EnsureAccountActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $u = $request->user();
        if ($u && $u->disabled_at !== null) {
            if ($request->hasSession()) {
                Auth::guard('web')->logout();
                $request->session()->invalidate();
            }
            return response()->json(['message' => 'This account is disabled. Contact an administrator.', 'code' => 'disabled'], 403);
        }
        return $next($request);
    }
}
