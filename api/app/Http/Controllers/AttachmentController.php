<?php

namespace App\Http\Controllers;

use App\Services\TripAccess;
use App\Support\Clean;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Trip attachments in a PRIVATE bucket (disk `attachments`: S3 in AWS, local in tests). The
 * browser never talks to S3: uploads and downloads stream through here after the access check
 * (SECURITY-PLAN T9, plan review item 3). Stored under random keys; served as downloads only.
 */
class AttachmentController extends Controller
{
    public const MAX_BYTES = 25 * 1024 * 1024;

    public static function view(object $a): array
    {
        return [
            'id' => $a->id, 'name' => $a->name, 'path' => '', 'size' => (int) $a->size, 'contentType' => $a->content_type,
            'uploadedBy' => $a->uploaded_by, 'uploadedByName' => $a->uploaded_by_name, 'createdAtMs' => self::ms($a->created_at),
        ];
    }

    public function index(Request $request, string $trip): JsonResponse
    {
        $t = TripAccess::needView($this->me($request), $trip);
        $rows = DB::table('attachments')->where('trip_id', $t->id)->orderByDesc('created_at')->get();
        return response()->json(['attachments' => $rows->map(fn ($a) => self::view($a))]);
    }

    public function store(Request $request, string $trip): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $file = $request->file('file');
        if (!$file || !$file->isValid()) {
            return $this->fail(422, 'Choose a file.');
        }
        if ($file->getSize() > self::MAX_BYTES) {
            return $this->fail(413, 'That file is larger than 25 MB.');
        }
        if (DB::table('attachments')->where('trip_id', $t->id)->count() >= 500) {
            return $this->fail(429, 'This trip has too many attachments.');
        }
        $id = (string) Str::ulid();
        // Random object key; the original name is kept only as data, never as a path.
        $key = "trips/{$t->id}/{$id}";
        Storage::disk('attachments')->putFileAs("trips/{$t->id}", $file, $id);
        $name = Clean::text($file->getClientOriginalName(), 200) ?: 'file';
        $type = Clean::text($file->getMimeType() ?: 'application/octet-stream', 120);
        try {
            DB::table('attachments')->insert([
                'id' => $id, 'trip_id' => $t->id, 'name' => $name, 'disk_path' => $key, 'size' => $file->getSize(), 'content_type' => $type,
                'uploaded_by' => $u->id, 'uploaded_by_name' => self::nameOf($u), 'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Storage::disk('attachments')->delete($key);
            throw $e;
        }
        return response()->json(['id' => $id], 201);
    }

    public function download(Request $request, string $trip, string $id): StreamedResponse
    {
        $t = TripAccess::needView($this->me($request), $trip);
        $a = $this->find($t->id, $id);
        $disk = Storage::disk('attachments');
        abort_unless($disk->exists($a->disk_path), 404, 'Not found.');
        return $disk->download($a->disk_path, $a->name, [
            'Content-Type' => 'application/octet-stream', 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'no-store, private',
        ]);
    }

    public function destroy(Request $request, string $trip, string $id): JsonResponse
    {
        $u = $this->me($request);
        $t = TripAccess::needView($u, $trip);
        $a = $this->find($t->id, $id);
        if ($a->uploaded_by !== $u->id && !$u->is_host) {
            TripAccess::deny($u, "attachment:{$id}", 403);
        }
        Storage::disk('attachments')->delete($a->disk_path);
        DB::table('attachments')->where('id', $a->id)->delete();
        return response()->json(['ok' => true]);
    }

    private function find(string $tripId, string $id): object
    {
        $a = Clean::isId($id) ? DB::table('attachments')->where('id', $id)->where('trip_id', $tripId)->first() : null;
        abort_unless($a, 404, 'Not found.');
        return $a;
    }
}
