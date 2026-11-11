<?php

use App\Http\Middleware\AuditTrail;
use App\Http\Middleware\EnsureAccountActive;
use App\Http\Middleware\EnsureEmailVerified;
use App\Http\Middleware\IdleTimeout;
use App\Http\Middleware\RequestGuard;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/*
| Voyager Trip Manager API. JSON only, under /api/v1, authenticated with Sanctum's SPA (session
| cookie + CSRF) mode on the same origin as the PWA. docs/SECURITY-PLAN.md §4 lists the controls.
*/
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        apiPrefix: 'api/v1',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Only the load balancer is trusted to set X-Forwarded-* (plan review item 11).
        $middleware->trustProxies(
            at: array_filter(explode(',', (string) env('TRUSTED_PROXIES', ''))),
            headers: Request::HEADER_X_FORWARDED_FOR | Request::HEADER_X_FORWARDED_PROTO | Request::HEADER_X_FORWARDED_PORT,
        );
        $middleware->statefulApi();
        $middleware->prependToGroup('api', [RequestGuard::class]);
        $middleware->appendToGroup('api', [SecurityHeaders::class, IdleTimeout::class, EnsureAccountActive::class, AuditTrail::class]);
        $middleware->alias(['verified.email' => EnsureEmailVerified::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn () => true);
        // Never send internals to the client: generic message for anything that is not an HTTP error
        // or a validation failure (details stay in the server log with the request id).
        $exceptions->render(function (\Throwable $e, Request $request) {
            if ($e instanceof HttpExceptionInterface || $e instanceof \Illuminate\Validation\ValidationException
                || $e instanceof \Illuminate\Auth\AuthenticationException || config('app.debug')) {
                return null;
            }
            return response()->json(['message' => 'Something went wrong.', 'requestId' => $request->attributes->get('request_id')], 500);
        });
    })->create();
