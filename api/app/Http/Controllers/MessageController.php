<?php

namespace App\Http\Controllers;

use App\Services\Notifier;
use App\Services\TripAccess;
use App\Support\Clean;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Team messages: everyone on the trip, HOST, and controllers while the trip is live read and post;
 * you delete only your own. Last-read times drive the unread line and badges.
 */
class MessageController extends Controller
{
    public static function view(object $m): array
    {
        return ['id' => $m->id, 'senderUid' => $m->sender_id, 'senderName' => $m->sender_name, 'text' => $m->text, 'createdAtMs' => self::ms($m->created_at), 'pending' => false];
    }

    public function index(Request $request, string $trip): JsonResponse
    {
        $t = TripAccess::needMessages($this->me($request), $trip);
        $rows = DB::table('messages')->where('trip_id', $t->id)->orderBy('created_at')->limit(2000)->get();
        return response()->json(['messages' => $rows->map(fn ($m) => self::view($m))]);
    }

    public function store(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needMessages($u, $trip);
        $text = Clean::text($request->input('text'), 4000);
        if ($text === '') {
            return $this->fail(422, 'Write a message.');
        }
        $id = (string) Str::ulid();
        DB::table('messages')->insert(['id' => $id, 'trip_id' => $t->id, 'sender_id' => $u->id, 'sender_name' => self::nameOf($u), 'text' => $text, 'created_at' => now()]);
        $members = DB::table('trip_members')->where('trip_id', $t->id)->pluck('user_id')->all();
        Notifier::send(
            Notifier::recipients($members, $u->id), 'message', self::nameOf($u) . ' · ' . ($t->name ?: 'Trip'),
            mb_strlen($text) > 140 ? mb_substr($text, 0, 137) . '…' : $text, $t->id, "/trips/{$t->id}/messages",
        );
        return response()->json(['id' => $id], 201);
    }

    public function destroy(Request $request, string $trip, string $id): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needMessages($u, $trip);
        $n = Clean::isId($id) ? DB::table('messages')->where('id', $id)->where('trip_id', $t->id)->where('sender_id', $u->id)->delete() : 0;
        return $n ? response()->json(['ok' => true]) : $this->fail(404, 'Not found.');
    }

    public function readAt(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needMessages($u, $trip);
        $at = DB::table('trip_reads')->where('user_id', $u->id)->where('trip_id', $t->id)->value('read_at');
        return response()->json(['readAtMs' => self::ms($at)]);
    }

    public function markRead(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needMessages($u, $trip);
        DB::table('trip_reads')->upsert([['user_id' => $u->id, 'trip_id' => $t->id, 'read_at' => now()]], ['user_id', 'trip_id'], ['read_at']);
        return response()->json(['ok' => true]);
    }
}
