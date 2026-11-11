<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Everything that touches trip data needs a CONFIRMED email (as `verified()` in firestore.rules). */
class EnsureEmailVerified
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!$request->user()?->isVerified()) {
            return response()->json(['message' => 'Confirm your email first.', 'code' => 'unverified'], 403);
        }
        return $next($request);
    }
}
