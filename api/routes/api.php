<?php

use App\Http\Controllers\AttachmentController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ItemController;
use App\Http\Controllers\MessageController;
use App\Http\Controllers\PasskeyController;
use App\Http\Controllers\PeopleController;
use App\Http\Controllers\RecordsController;
use App\Http\Controllers\TeamController;
use App\Http\Controllers\TripController;
use Illuminate\Support\Facades\Route;

/*
| /api/v1 — every endpoint the PWA uses (web/src/api/store.ts). Signed-out routes are few and
| throttled; everything else needs a session (Sanctum) AND a confirmed email, and authorises each
| record through App\Services\TripAccess.
*/

Route::get('auth/session', [AuthController::class, 'session']);

Route::middleware('throttle:auth')->group(function () {
    Route::post('auth/register', [AuthController::class, 'register']);
    Route::post('auth/login', [AuthController::class, 'login']);
    Route::post('auth/forgot-password', [AuthController::class, 'forgotPassword']);
    Route::post('auth/reset-password/check', [AuthController::class, 'checkResetToken']);
    Route::post('auth/reset-password', [AuthController::class, 'resetPassword']);
    Route::post('auth/verify-email/{id}/{hash}', [AuthController::class, 'verifyEmail'])->name('verification.verify');
    Route::post('auth/verify-email', [AuthController::class, 'verifyEmail']);
    Route::post('auth/passkey/options', [PasskeyController::class, 'signInOptions']);
    Route::post('auth/passkey', [PasskeyController::class, 'signIn']);
});

Route::middleware('auth:sanctum')->group(function () {
    Route::post('auth/logout', [AuthController::class, 'logout']);
    Route::post('auth/verify-email/resend', [AuthController::class, 'resendVerification'])->middleware('throttle:auth');

    Route::middleware(['verified.email', 'throttle:app'])->group(function () {
        Route::post('me/sync-pending', [TripController::class, 'syncPending']);
        Route::get('passkeys', [PasskeyController::class, 'index']);
        Route::post('passkeys/options', [PasskeyController::class, 'registrationOptions']);
        Route::post('passkeys', [PasskeyController::class, 'register']);
        Route::delete('passkeys/{id}', [PasskeyController::class, 'destroy']);

        Route::get('directory', [PeopleController::class, 'directory']);
        Route::get('teams', [TeamController::class, 'index']);
        Route::post('teams', [TeamController::class, 'store']);
        Route::put('teams/{id}', [TeamController::class, 'update']);
        Route::delete('teams/{id}', [TeamController::class, 'destroy']);
        Route::get('contacts', [PeopleController::class, 'contacts']);
        Route::post('contacts', [PeopleController::class, 'saveContact']);
        Route::put('contacts/{id}', [PeopleController::class, 'saveContact']);
        Route::delete('contacts/{id}', [PeopleController::class, 'deleteContact']);

        Route::get('notifications', [PeopleController::class, 'notifications']);
        Route::post('notifications/{id}/read', [PeopleController::class, 'markNotification']);
        Route::delete('notifications/{id}', [PeopleController::class, 'clearNotification']);
        Route::get('push/key', [PeopleController::class, 'pushKey']);
        Route::post('push/subscriptions', [PeopleController::class, 'subscribePush']);
        Route::post('push/subscriptions/remove', [PeopleController::class, 'unsubscribePush']);

        Route::get('admin/accounts', [PeopleController::class, 'accounts'])->name('admin.accounts.index');
        Route::post('admin/accounts', [PeopleController::class, 'createAccount']);
        Route::put('admin/accounts/{id}/roles', [PeopleController::class, 'setRoles']);
        Route::delete('admin/accounts/{id}', [PeopleController::class, 'deleteAccount']);
        Route::post('admin/role', [PeopleController::class, 'setRole']);

        Route::get('trip-requests', [TripController::class, 'requests']);
        Route::post('trip-requests', [TripController::class, 'submitRequest']);
        Route::get('trip-requests/{id}', [TripController::class, 'showRequest']);
        Route::post('trip-requests/{id}/decline', [TripController::class, 'declineRequest']);

        Route::get('live-trips', [TripController::class, 'liveTrips']);
        Route::get('trips', [TripController::class, 'trips']);
        Route::post('trips', [TripController::class, 'create']);

        Route::prefix('trips/{trip}')->group(function () {
            Route::get('/', [TripController::class, 'show']);
            Route::patch('/', [TripController::class, 'update']);
            Route::put('roles', [TripController::class, 'updateRoles']);
            Route::get('members', [TripController::class, 'members']);
            Route::post('access', [TripController::class, 'addAccess']);
            Route::post('access/remove', [TripController::class, 'removeAccess']);

            Route::get('items/{kind}', [ItemController::class, 'index']);
            Route::post('items/{kind}', [ItemController::class, 'store']);
            Route::put('items/{kind}/{id}', [ItemController::class, 'update']);
            Route::delete('items/{kind}/{id}', [ItemController::class, 'destroy']);
            Route::post('flights/{id}/decision', [ItemController::class, 'decide']);

            Route::get('messages', [MessageController::class, 'index']);
            Route::post('messages', [MessageController::class, 'store'])->middleware('throttle:messages');
            Route::delete('messages/{id}', [MessageController::class, 'destroy']);
            Route::get('read', [MessageController::class, 'readAt']);
            Route::post('read', [MessageController::class, 'markRead']);

            Route::get('attachments', [AttachmentController::class, 'index']);
            Route::post('attachments', [AttachmentController::class, 'store'])->name('attachments.store')->middleware('throttle:uploads');
            Route::get('attachments/{id}/download', [AttachmentController::class, 'download'])->name('attachments.download');
            Route::delete('attachments/{id}', [AttachmentController::class, 'destroy']);

            Route::get('requests', [RecordsController::class, 'tlIndex']);
            Route::post('requests', [RecordsController::class, 'tlStore']);
            Route::post('requests/{id}/decide', [RecordsController::class, 'tlDecide']);
            Route::post('requests/{id}/resubmit', [RecordsController::class, 'tlResubmit']);
            Route::delete('requests/{id}', [RecordsController::class, 'tlDestroy']);

            Route::get('summaries', [RecordsController::class, 'summaries']);
            Route::put('summaries/{role}', [RecordsController::class, 'saveSummary']);

            Route::get('vaccinations', [RecordsController::class, 'vaccinations'])->name('vaccinations.index');
            Route::put('vaccinations', [RecordsController::class, 'saveVaccination']);

            Route::get('debrief', [RecordsController::class, 'debrief']);
            Route::put('debrief', [RecordsController::class, 'saveDebrief']);

            Route::get('finance', [RecordsController::class, 'finance']);
            Route::post('finance', [RecordsController::class, 'saveFinance']);
            Route::put('finance/{id}', [RecordsController::class, 'saveFinance']);
            Route::delete('finance/{id}', [RecordsController::class, 'deleteFinance']);
            Route::put('finance-note', [RecordsController::class, 'saveFinanceNote']);

            Route::get('contacts', [RecordsController::class, 'tripContacts']);
            Route::put('contacts/{contact}', [RecordsController::class, 'addTripContact']);
            Route::delete('contacts/{contact}', [RecordsController::class, 'removeTripContact']);

            Route::get('snapshot', [RecordsController::class, 'snapshot'])->name('trips.snapshot');
        });
    });
});
