<?php
// Restrict CORS to the production domain; allow any origin only in local dev
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = ['https://muhafid.com', 'https://www.muhafid.com'];
if (in_array($origin, $allowedOrigins, true)) {
    header("Access-Control-Allow-Origin: {$origin}");
} elseif (getenv('APP_ENV') === 'local') {
    header("Access-Control-Allow-Origin: *");
}
header("Content-Type: application/json; charset=UTF-8");
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Strict-Transport-Security: max-age=31536000');
header('Cache-Control: no-store');   // API answers are never cached (the image proxy overrides this)
header_remove('X-Powered-By');

// --- Helper Functions ---

/**
 * Simple .env loader
 */
function loadEnv($path)
{
    if (!file_exists($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0)
            continue;

        list($name, $value) = explode('=', $line, 2);
        $name = trim($name);
        $value = trim($value);

        if (!array_key_exists($name, $_SERVER) && !array_key_exists($name, $_ENV)) {
            putenv(sprintf('%s=%s', $name, $value));
            $_ENV[$name] = $value;
            $_SERVER[$name] = $value;
        }
    }
}

/**
 * Connect to MySQL using credentials from .env
 * Returns a PDO instance or null if DB vars are not configured.
 */
function getDB()
{
    $host = getenv('DB_HOST') ?: '';
    $name = getenv('DB_NAME') ?: '';
    $user = getenv('DB_USER') ?: '';
    $pass = getenv('DB_PASS') ?: '';

    if (!$host || !$name || !$user) {
        return null; // DB not configured — fall back gracefully
    }

    try {
        $port = '3306';
        if (strpos($host, ':') !== false) {
            [$host, $port] = explode(':', $host, 2);
        }

        $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        return $pdo;
    } catch (PDOException $e) {
        // Log to error_log but never expose credentials to the client
        error_log('CCCC DB connection failed: ' . $e->getMessage());
        return null;
    }
}

/**
 * Filter out anime/Japanese content from TMDB results
 * For TV/Movie searches, we exclude all Japanese content to keep anime separate
 */
function filterAnimeFromTMDB($data)
{
    if (!isset($data['results']) || !is_array($data['results'])) {
        return $data;
    }

    $filtered = [];
    foreach ($data['results'] as $item) {
        $isJapanese = false;

        // Check if it's from Japan
        if (isset($item['origin_country']) && is_array($item['origin_country']) && in_array('JP', $item['origin_country'])) {
            $isJapanese = true;
        }

        // Also check original_language for Japanese
        if (isset($item['original_language']) && $item['original_language'] === 'ja') {
            $isJapanese = true;
        }

        // Only include non-Japanese items
        if (!$isJapanese) {
            $filtered[] = $item;
        }
    }

    $data['results'] = $filtered;
    return $data;
}

/**
 * Filter out games with NSFW tags from RAWG results
 */
function filterNSFWFromRAWG($data)
{
    if (!isset($data['results']) || !is_array($data['results'])) {
        return $data;
    }

    $nsfwTags = ['eroge', 'hentai']; // Only block actual porn games — mainstream games with mature tags should be classifiable
    $filtered = [];

    foreach ($data['results'] as $item) {
        $isNsfw = false;
        if (isset($item['tags']) && is_array($item['tags'])) {
            foreach ($item['tags'] as $tag) {
                if (isset($tag['slug']) && in_array(strtolower($tag['slug']), $nsfwTags)) {
                    $isNsfw = true;
                    break;
                }
            }
        }
        if (!$isNsfw) {
            $filtered[] = $item;
        }
    }

    $data['results'] = $filtered;
    return $data;
}

/**
 * Search normalisation: lower-case, "&" -> "and", punctuation to spaces, common game
 * abbreviations expanded (GTA -> grand theft auto) and Roman numerals II–XX, V, X turned
 * into numbers (VI -> 6), so "GTA 6", "gta vi" and "Grand Theft Auto VI" all compare equal.
 * A lone "I" is left alone (too common as a word).
 */
const SEARCH_ABBREVIATIONS = [
    'gta' => 'grand theft auto', 'cod' => 'call of duty', 'rdr' => 'red dead redemption',
    'gow' => 'god of war', 'ff' => 'final fantasy', 'mgs' => 'metal gear solid',
    'tlou' => 'the last of us', 'botw' => 'breath of the wild', 'totk' => 'tears of the kingdom',
    'ac' => 'assassins creed', 'nfs' => 'need for speed', 'ds' => 'dark souls',
];
const SEARCH_ROMAN = [
    'ii' => 2, 'iii' => 3, 'iv' => 4, 'v' => 5, 'vi' => 6, 'vii' => 7, 'viii' => 8, 'ix' => 9, 'x' => 10,
    'xi' => 11, 'xii' => 12, 'xiii' => 13, 'xiv' => 14, 'xv' => 15, 'xvi' => 16, 'xvii' => 17,
    'xviii' => 18, 'xix' => 19, 'xx' => 20,
];

function normalizeSearchTitle($s)
{
    $s = mb_strtolower((string)$s, 'UTF-8');
    $s = str_replace(['&', "'", '’'], [' and ', '', ''], $s);
    $s = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $s);
    $out = [];
    foreach (preg_split('/\s+/', trim($s)) as $w) {
        if ($w === '') continue;
        if (isset(SEARCH_ABBREVIATIONS[$w])) $w = SEARCH_ABBREVIATIONS[$w];
        elseif (isset(SEARCH_ROMAN[$w])) $w = (string)SEARCH_ROMAN[$w];
        $out[] = $w;
    }
    return implode(' ', $out);
}

/**
 * Extra RAWG search texts for a game query: abbreviations expanded, and the same text with
 * its number written the other way (6 <-> VI), because RAWG's own search matches the text
 * literally ("GTA 6" finds Far Cry 6, not Grand Theft Auto VI). Returns up to 2 queries.
 */
function gameSearchQueries($query)
{
    $words = preg_split('/\s+/', trim(mb_strtolower((string)$query, 'UTF-8')));
    $expanded = [];
    foreach ($words as $w) $expanded[] = SEARCH_ABBREVIATIONS[$w] ?? $w;
    $primary = implode(' ', $expanded);
    $toRoman = array_flip(SEARCH_ROMAN);
    $swapped = [];
    foreach ($expanded as $w) {
        if (ctype_digit($w) && isset($toRoman[(int)$w])) $swapped[] = $toRoman[(int)$w];
        elseif (isset(SEARCH_ROMAN[$w])) $swapped[] = (string)SEARCH_ROMAN[$w];
        else $swapped[] = $w;
    }
    $alt = implode(' ', $swapped);
    return $alt !== $primary ? [$primary, $alt] : [$primary];
}

/**
 * Smart Search Sorting Algorithm
 * Ranks by how well the title matches first (exact > starts with > contains), then by
 * popularity on a log scale, so an exact title wins over a merely popular one (GTA VI over
 * GTA V while VI is new), yet a popular sequel still beats an obscure exact namesake.
 * Titles and query are compared normalised (see normalizeSearchTitle).
 */
function applySmartSort($data, $type, $query)
{
    $dataKey = 'results';
    if ($type === 'anime' || $type === 'manga') $dataKey = 'data';
    else if ($type === 'book') $dataKey = 'docs';

    if (!isset($data[$dataKey]) || !is_array($data[$dataKey])) return $data;

    $items = $data[$dataKey];
    $q = normalizeSearchTitle($query);

    foreach ($items as &$item) {
        $titles = [];
        $popularity = 0;

        if ($type === 'movie' || $type === 'tv') {
            $titles = [$item['title'] ?? $item['name'] ?? '', $item['original_title'] ?? $item['original_name'] ?? ''];
            $popularity = $item['popularity'] ?? 0;
        } else if ($type === 'game') {
            $titles = [$item['name'] ?? ''];
            $popularity = $item['added'] ?? 0;
        } else if ($type === 'anime' || $type === 'manga') {
            $titles = [$item['title'] ?? '', $item['title_english'] ?? ''];
            $popularity = $item['members'] ?? 0;
        } else if ($type === 'book') {
            $titles = [$item['title'] ?? ''];
            $popularity = ($item['readinglog_count'] ?? 0) + ($item['ratings_count'] ?? 0);
        }

        $tier = 0;   // 3 exact, 2 starts with, 1 contains, 0 neither — best over the work's titles
        foreach ($titles as $t) {
            $t = normalizeSearchTitle($t);
            if ($t === '' || $q === '') continue;
            if ($t === $q) $tier = max($tier, 3);
            elseif (strpos($t, $q) === 0) $tier = max($tier, 2);
            elseif (strpos($t, $q) !== false) $tier = max($tier, 1);
        }

        $item['_smart_score'] = $tier * 2 + log10(max(0, (float)$popularity) + 1);
    }
    unset($item);

    usort($items, function($a, $b) {
        return $b['_smart_score'] <=> $a['_smart_score'];
    });

    foreach ($items as &$item) {
        unset($item['_smart_score']);
    }

    $data[$dataKey] = array_slice($items, 0, 5);

    return $data;
}

/**
 * HowLongToBeat scraper functions
 * Discovers the dynamic API path/key from HLTB's JS bundle,
 * then searches for a game and returns completion times.
 */

function hltbHeaders($extra = [])
{
    return array_merge([
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'Accept: */*',
        'Referer: https://howlongtobeat.com/',
        'Origin: https://howlongtobeat.com',
    ], $extra);
}

/**
 * Low-level HLTB request. Returns ['code' => int, 'body' => string|null].
 */
function hltbRequest($url, $postBody = null, $extraHeaders = [], $timeout = 5)
{
    if (!function_exists('curl_init')) return ['code' => 0, 'body' => null]; // PHP cURL extension not enabled
    $verifySSL = getenv('APP_ENV') !== 'local';
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => $verifySSL,
        CURLOPT_SSL_VERIFYHOST => $verifySSL ? 2 : 0,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER => hltbHeaders($extraHeaders),
    ];
    if ($postBody !== null) {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = $postBody;
    }
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'body' => $body === false ? null : $body];
}

/**
 * HLTB moves its private search endpoint every few months (/api/search ->
 * /api/s -> /api/bleed -> /api/search/site ...). Instead of hardcoding it,
 * read it from the site's own JS bundles — the same approach the maintained
 * howlongtobeatpy library uses. Result is cached for 24h.
 */
function hltbDiscoverSearchPath()
{
    $home = hltbRequest('https://howlongtobeat.com/');
    if ($home['code'] !== 200 || !$home['body']) return null;

    preg_match_all('#src="(/_next/static/chunks/[^"]+\.js)"#', $home['body'], $m);
    foreach (array_unique($m[1]) as $chunk) {
        $js = hltbRequest('https://howlongtobeat.com' . $chunk, null, [], 6);
        if ($js['code'] !== 200 || !$js['body']) continue;
        // e.g. fetch("/api/search/site",{method:"POST",headers:{...,"x-auth-token":t}
        if (preg_match('#fetch\(\s*["\'`]/api/([a-zA-Z0-9_/]+)["\'`]\s*,\s*\{\s*method:\s*["\']POST["\'][^}]{0,200}x-auth-token#', $js['body'], $hit)) {
            return trim($hit[1], '/');
        }
    }
    return null;
}

/**
 * GET <path>/init -> {token, [hpKey, hpVal]}. Older HLTB versions also
 * returned a honeypot key/value pair that had to be echoed back; pick those
 * up if present so the same code keeps working if they return.
 */
function hltbInit($path)
{
    $ms = (int)round(microtime(true) * 1000);
    $res = hltbRequest("https://howlongtobeat.com/api/{$path}/init?t={$ms}");
    if ($res['code'] !== 200 || !$res['body']) return ['code' => $res['code'], 'auth' => null];
    $json = json_decode($res['body'], true);
    if (!is_array($json) || empty($json['token'])) return ['code' => $res['code'], 'auth' => null];

    $auth = ['token' => $json['token'], 'hpKey' => null, 'hpVal' => null];
    foreach ($json as $k => $v) {
        if ($k === 'token' || !is_string($v)) continue;
        if (stripos($k, 'key') !== false) $auth['hpKey'] = $v;
        elseif (stripos($k, 'val') !== false) $auth['hpVal'] = $v;
    }
    return ['code' => 200, 'auth' => $auth];
}

function hltbSearchRequest($path, $auth, $gameName)
{
    $include = ['mode' => 'include', 'values' => []];
    $payload = [
        'searchType' => 'games',
        'searchTerms' => preg_split('/\s+/', trim($gameName)),
        'searchPage' => 1,
        'size' => 5,
        'searchOptions' => [
            'games' => [
                'userId' => 0,
                'platform' => $include,
                'sortCategory' => 'popular',
                'rangeCategory' => 'main',
                'rangeTime' => ['min' => null, 'max' => null],
                'gameplay' => ['perspective' => $include, 'flow' => $include, 'genre' => $include],
                'year' => $include,
                'modifier' => '',
            ],
            'users' => ['sortCategory' => 'postcount'],
            'lists' => ['sortCategory' => 'follows'],
            'filter' => '',
            'sort' => 0,
            'randomizer' => 0,
        ],
        'useCache' => true,
    ];
    $headers = ['Content-Type: application/json', "x-auth-token: {$auth['token']}"];
    if ($auth['hpKey'] && $auth['hpVal']) {
        $payload[$auth['hpKey']] = $auth['hpVal'];
        $headers[] = "x-hp-key: {$auth['hpKey']}";
        $headers[] = "x-hp-val: {$auth['hpVal']}";
    }
    return hltbRequest("https://howlongtobeat.com/api/{$path}", json_encode($payload), $headers, 10);
}

function searchHltb($gameName)
{
    global $dataDir;

    $cacheFile = $dataDir . '/hltb_cache.json';
    $cache = [];
    if (file_exists($cacheFile)) {
        $cache = json_decode(@file_get_contents($cacheFile), true) ?: [];
    }
    $saveCache = function () use (&$cache, $cacheFile) {
        if (count($cache) > 500) {
            uasort($cache, function ($a, $b) { return ($a['ts'] ?? 0) - ($b['ts'] ?? 0); });
            $cache = array_slice($cache, -400, null, true);
        }
        @file_put_contents($cacheFile, json_encode($cache, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
    };

    // 1. Result cache (30 days)
    $cacheKey = strtolower(trim($gameName));
    if (isset($cache[$cacheKey]['data']) && (time() - ($cache[$cacheKey]['ts'] ?? 0)) < 86400 * 30) {
        return $cache[$cacheKey]['data'];
    }

    // 2. Endpoint path: cached 24h, rediscovered when stale or when HLTB rejects it
    $fresh = isset($cache['_endpoint']['path']) && (time() - ($cache['_endpoint']['ts'] ?? 0)) < 86400;
    $path = $fresh ? $cache['_endpoint']['path'] : null;
    $discovered = false;

    for ($attempt = 0; $attempt < 2; $attempt++) {
        if (!$path) {
            // Rediscovery fetches every JS chunk of HLTB's site: at most once an hour, so a
            // broken endpoint can't make every request do it
            $recentDiscovery = (time() - ($cache['_discovery']['ts'] ?? 0)) < 3600;
            $path = (!$recentDiscovery ? hltbDiscoverSearchPath() : null) ?: ($cache['_endpoint']['path'] ?? 'search/site');
            if (!$recentDiscovery) $cache['_discovery'] = ['ts' => time()];
            $discovered = true;
            $cache['_endpoint'] = ['ts' => time(), 'path' => $path];
            $saveCache();
        }

        $init = hltbInit($path);
        if (!$init['auth']) {
            // 404 = endpoint moved: rediscover once
            if (!$discovered) { $path = null; continue; }
            return null;
        }

        $res = hltbSearchRequest($path, $init['auth'], $gameName);
        if ($res['code'] === 200) break;
        // 403 = token rejected, 404 = endpoint moved: retry once with fresh discovery + token
        if (in_array($res['code'], [403, 404], true) && !$discovered) { $path = null; continue; }
        return null;
    }
    if (!isset($res) || $res['code'] !== 200) return null;

    $data = json_decode($res['body'], true);
    if (!$data || empty($data['data'])) return null;

    // 3. Pick the best match: exact title if present, otherwise the most popular hit
    $game = $data['data'][0];
    foreach ($data['data'] as $g) {
        if (strcasecmp(trim($g['game_name'] ?? ''), trim($gameName)) === 0) { $game = $g; break; }
    }
    // comp_main is in seconds -> hours, rounded to nearest 0.5
    $mainSeconds = $game['comp_main'] ?? 0;
    $mainHours = $mainSeconds > 0 ? round($mainSeconds / 3600 * 2) / 2 : 0;

    $result = [
        'main_story' => $mainHours,
        'game_name' => $game['game_name'] ?? '',
    ];

    // 4. Cache the result
    $cache[$cacheKey] = ['ts' => time(), 'data' => $result];
    $saveCache();

    return $result;
}


/**
 * The visitor's address, for vote dedup and rate limiting. Behind a proxy, REMOTE_ADDR is
 * the proxy, and the real address is in a header — but which header is trustworthy depends
 * on the host, and the client controls any header when it can reach the origin directly
 * (e.g. the *.cranl.net deployment URL). So:
 *   - if TRUSTED_IP_HEADER is set (e.g. "X-Real-IP"), use that header — set it to whatever
 *     the host's edge guarantees it overwrites, so a client can't forge it;
 *   - otherwise fall back to the LAST X-Forwarded-For entry (the one the edge appends;
 *     earlier entries are client-supplied), then REMOTE_ADDR.
 * The value must parse as an IP, so a junk header can never poison the hash.
 */
function clientIp()
{
    $valid = function ($ip) { $ip = trim((string)$ip); return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : null; };

    $header = getenv('TRUSTED_IP_HEADER');
    if ($header) {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $header));
        $parts = explode(',', $_SERVER[$key] ?? '');
        if ($ip = $valid(end($parts))) return $ip;
    }
    $fwd = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
    if ($ip = $valid(end($fwd))) return $ip;
    return $valid($_SERVER['REMOTE_ADDR'] ?? '') ?? 'unknown';
}

/**
 * The visitor's address as stored: HMAC-SHA256 keyed with IP_HASH_SECRET (env), so a leaked
 * database can't be reversed by hashing all ~4 billion IPv4 addresses. Without the secret it
 * falls back to the plain SHA-256 used before (legacyIpHash), so nothing breaks before it's set.
 */
function ipHash()
{
    $secret = (string)getenv('IP_HASH_SECRET');
    return strlen($secret) >= 16 ? hash_hmac('sha256', clientIp(), $secret) : legacyIpHash();
}
function legacyIpHash()
{
    return hash('sha256', clientIp());
}

/**
 * The work's real title, from its source, by id — so the catalogue never stores a title the
 * browser made up (the card title is editable, and the API can be called directly).
 *   ['found' => true, 'title' => '…']  the source knows this id
 *   ['found' => false]                 the source says this id doesn't exist -> reject the rating
 *   null                               couldn't check (source down, no key) -> caller decides
 */
function canonicalTitle($type, $id)
{
    global $TMDB_KEY, $RAWG_KEY;
    // fetchUrl() wraps any non-200 reply as {"error":"Upstream API returned status N", ...}:
    // a 404 means "no such work", anything else (timeout, 429, 5xx) means "couldn't check".
    $get = function ($url, $headers = [], $post = null) {
        $d = json_decode((string)fetchUrl($url, $headers, $post, 4), true);
        if (!is_array($d)) return [0, null];
        if (isset($d['error']) && is_string($d['error']) && preg_match('/status (\d{3})/', $d['error'], $m)) return [(int)$m[1], null];
        if (isset($d['error']) && is_string($d['error'])) return [0, null];   // network error
        return [200, $d];
    };
    $found = fn($t) => ['found' => true, 'title' => (string)$t];
    if (($type === 'anime' || $type === 'manga') && preg_match('/^anilist:(\d+)$/', $id, $m)) {
        $q = json_encode(['query' => 'query($id:Int,$t:MediaType){Media(id:$id,type:$t){title{english romaji}}}',
                          'variables' => ['id' => (int)$m[1], 't' => strtoupper($type)]]);
        [$st, $d] = $get('https://graphql.anilist.co', ['Content-Type: application/json', 'Accept: application/json'], $q);
        $t = $d['data']['Media']['title'] ?? null;
        if ($t) return $found(($t['english'] ?? '') ?: ($t['romaji'] ?? ''));
        return $st === 404 ? ['found' => false] : null;
    }
    if (($type === 'anime' || $type === 'manga') && preg_match('/^kitsu:(\d+)$/', $id, $m)) {
        [$st, $d] = $get("https://kitsu.io/api/edge/$type/" . (int)$m[1], ['Accept: application/vnd.api+json']);
        $a = $d['data']['attributes'] ?? null;
        if ($a) return $found(($a['titles']['en'] ?? '') ?: ($a['canonicalTitle'] ?? ''));
        return $st === 404 ? ['found' => false] : null;
    }
    if (($type === 'anime' || $type === 'manga') && preg_match('/^mal:(\d+)$/', $id, $m)) {
        [$st, $d] = $get("https://api.jikan.moe/v4/$type/" . (int)$m[1]);
        if (!empty($d['data'])) return $found(($d['data']['title_english'] ?? '') ?: ($d['data']['title'] ?? ''));
        return $st === 404 ? ['found' => false] : null;
    }
    if (($type === 'movie' || $type === 'tv') && ctype_digit($id) && $TMDB_KEY) {
        [$st, $d] = $get("https://api.themoviedb.org/3/$type/$id?api_key=$TMDB_KEY&language=en-US");
        $t = $type === 'movie' ? ($d['title'] ?? '') : ($d['name'] ?? '');
        if ($t !== '') return $found($t);
        return $st === 404 ? ['found' => false] : null;
    }
    if ($type === 'game' && preg_match('/^igdb-(\d{1,10})$/', $id, $m)) {
        $d = igdbQuery('games', 'fields name; where id = ' . (int)$m[1] . ';');
        if (!empty($d[0]['name'])) return $found($d[0]['name']);
        return is_array($d) ? ['found' => false] : null;   // empty list = no such game; null = couldn't check
    }
    if ($type === 'game' && preg_match('/^[a-z0-9-]{1,200}$/i', $id) && $RAWG_KEY) {
        [$st, $d] = $get("https://api.rawg.io/api/games/$id?key=$RAWG_KEY");
        if (!empty($d['name'])) return $found($d['name']);
        return $st === 404 ? ['found' => false] : null;
    }
    if ($type === 'book' && preg_match('#^/works/OL\d{1,12}W$#', $id)) {
        [$st, $d] = $get("https://openlibrary.org$id.json");
        if (!empty($d['title'])) return $found($d['title']);
        return $st === 404 ? ['found' => false] : null;
    }
    return null;   // manual entries (and sources without a key): nothing to check against
}

/**
 * Server-side cache for answers from outside services, in the temp dir (best effort: a dir
 * that can't be written just means no cache). Saves API quotas and time:
 *  - searches: 10 min; game searches 24 h (RAWG's free plan is 20,000 calls a month) when the
 *    search fully succeeded, otherwise 10 min so a gap heals quickly; only non-empty results;
 *  - game details 7 days; the chosen SteamGridDB cover 7 days ("none found" 1 day).
 * CACHE_VERSION is part of every key: bump it when filtering/sorting/slimming changes, so old
 * answers are never served. Each bucket keeps at most CACHE_MAX_FILES (oldest dropped first).
 */
const CACHE_VERSION = 3;
const CACHE_MAX_FILES = 3000;
const SEARCH_TYPES = ['movie', 'tv', 'game', 'anime', 'manga', 'book'];
function cacheFile($bucket, $key)
{
    return sys_get_temp_dir() . "/cccc-cache/$bucket/" . hash('sha256', CACHE_VERSION . '|' . $key) . '.json';
}
function cacheGet($bucket, $key, $ttl)
{
    $f = cacheFile($bucket, $key);
    $m = @filemtime($f);
    return ($m !== false && time() - $m < $ttl) ? @file_get_contents($f) : false;
}
// $keepFor < $ttl stores an entry that expires early (it's back-dated, so cacheGet sees it old)
function cachePut($bucket, $key, $body, $ttl, $keepFor = null)
{
    $f = cacheFile($bucket, $key);
    $dir = dirname($f);
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) return;
    if (mt_rand(1, 50) === 1) cachePrune($dir, $ttl);
    $tmp = $f . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, $body) === false) return;
    if (!@rename($tmp, $f)) { @unlink($tmp); return; }
    if ($keepFor !== null && $keepFor < $ttl) @touch($f, time() - ($ttl - $keepFor));
}
function cachePrune($dir, $ttl)
{
    $files = [];
    foreach (glob($dir . '/*.json') ?: [] as $f) {
        $m = @filemtime($f);
        if ($m === false) continue;
        if ($m < time() - $ttl) @unlink($f); else $files[$f] = $m;
    }
    if (count($files) > CACHE_MAX_FILES) {           // still too many: drop the oldest fifth
        asort($files);
        foreach (array_slice(array_keys($files), 0, count($files) - (int)(CACHE_MAX_FILES * 0.8)) as $f) @unlink($f);
    }
}
function searchKey($type, $query)
{
    return $type . '|' . preg_replace('/\s+/u', ' ', trim(mb_strtolower((string)$query, 'UTF-8')));
}
function searchTtl($type) { return $type === 'game' ? 86400 : 600; }
function searchCacheGet($type, $query)
{
    return cacheGet('search', searchKey($type, $query), searchTtl($type));
}
function searchCachePut($type, $query, $response, $complete = true)
{
    $d = json_decode((string)$response, true);
    $key = ['anime' => 'data', 'manga' => 'data', 'book' => 'docs'][$type] ?? 'results';
    if (!is_array($d) || isset($d['error']) || empty($d[$key])) return;
    cachePut('search', searchKey($type, $query), $response, searchTtl($type), $complete ? null : 600);
}

/**
 * IGDB (Twitch): the main game source — no monthly cap (4 requests/second for the whole site),
 * free for non-commercial use. RAWG stays as the backup. Games from IGDB get ids "igdb-<n>"
 * (same character set as RAWG slugs, so the page and the rating log treat them alike).
 * The app access token (valid ~60 days) is kept in the temp dir and renewed before it expires.
 */
const IGDB_GAME_TYPES = '(0,2,4,8,9,10)';   // main game, expansion, standalone expansion, remake, remaster, expanded game
const IGDB_FIELDS = 'name,first_release_date,cover.image_id,artworks.image_id,artworks.width,artworks.height,'
    . 'screenshots.image_id,genres.name,themes.id,themes.name,platforms.name,aggregated_rating,aggregated_rating_count,'
    . 'total_rating,total_rating_count,hypes,summary';
function igdbConfigured()
{
    global $IGDB_CLIENT_ID, $IGDB_CLIENT_SECRET;
    return $IGDB_CLIENT_ID !== '' && $IGDB_CLIENT_SECRET !== '';
}
function igdbToken($renew = false)
{
    global $IGDB_CLIENT_ID, $IGDB_CLIENT_SECRET;
    $f = sys_get_temp_dir() . '/cccc-cache/igdb-token.json';
    $t = $renew ? null : json_decode((string)@file_get_contents($f), true);
    if (is_array($t) && !empty($t['token']) && ($t['exp'] ?? 0) > time() + 3600) return $t['token'];
    $r = json_decode((string)fetchUrl('https://id.twitch.tv/oauth2/token', ['Content-Type: application/x-www-form-urlencoded'],
        http_build_query(['client_id' => $IGDB_CLIENT_ID, 'client_secret' => $IGDB_CLIENT_SECRET, 'grant_type' => 'client_credentials']), 5), true);
    if (empty($r['access_token'])) return null;
    @mkdir(dirname($f), 0700, true);
    $tmp = $f . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, json_encode(['token' => $r['access_token'], 'exp' => time() + (int)($r['expires_in'] ?? 0)])) !== false) {
        @rename($tmp, $f) || @unlink($tmp);
    }
    return $r['access_token'];
}
// POST an Apicalypse query; returns the decoded list, or null on failure (renews the token once on 401)
function igdbQuery($endpoint, $body)
{
    global $IGDB_CLIENT_ID;
    if (!igdbConfigured() || upstreamDown('igdb')) return null;
    for ($try = 0; $try < 2; $try++) {
        $tok = igdbToken($try === 1);
        if (!$tok) break;
        $res = fetchUrl("https://api.igdb.com/v4/$endpoint", ["Client-ID: $IGDB_CLIENT_ID", "Authorization: Bearer $tok", 'Accept: application/json'], $body, 5);
        $d = json_decode((string)$res, true);
        if (is_array($d) && array_is_list($d)) { upstreamMark('igdb', true); return $d; }
        $st = upstreamStatus($res);
        if ($st === 401 && $try === 0) continue;                  // stale token: renew and retry once
        upstreamMark('igdb', false, $st === 429 ? 5 : 30);       // 429 = over 4/s: a short pause
        return null;
    }
    upstreamMark('igdb', false, 30);
    return null;
}
// IGDB genre names -> the names the site's Arabic genre table knows (themes add Action, Fantasy, …)
const IGDB_GENRE_MAP = [
    'Role-playing (RPG)' => 'RPG', 'Shooter' => 'Shooter', 'Platform' => 'Platformer', 'Puzzle' => 'Puzzle',
    'Racing' => 'Racing', 'Real Time Strategy (RTS)' => 'Strategy', 'Turn-based strategy (TBS)' => 'Strategy',
    'Strategy' => 'Strategy', 'Tactical' => 'Strategy', 'MOBA' => 'Strategy', 'Simulator' => 'Simulation',
    'Sport' => 'Sports', 'Fighting' => 'Fighting', 'Arcade' => 'Arcade', 'Pinball' => 'Arcade', 'Indie' => 'Indie',
    'Adventure' => 'Adventure', 'Point-and-click' => 'Adventure', 'Visual Novel' => 'Adventure',
    "Hack and slash/Beat 'em up" => 'Action', 'Card & Board Game' => 'Board Games', 'Music' => 'Music',
    'Quiz/Trivia' => 'Casual',
];
const IGDB_THEME_MAP = [
    'Action' => 'Action', 'Fantasy' => 'Fantasy', 'Science fiction' => 'Sci-Fi', 'Horror' => 'Horror',
    'Thriller' => 'Thriller', 'Survival' => 'Survival', 'Historical' => 'Historical', 'Comedy' => 'Comedy',
    'Drama' => 'Drama', 'Mystery' => 'Mystery', 'Kids' => 'Kids', 'Educational' => 'Educational', 'Warfare' => 'War',
];
const IGDB_EROTIC_THEME = 42;
function igdbImg($size, $id) { return $id ? "https://images.igdb.com/igdb/image/upload/t_$size/$id.jpg" : null; }
// One IGDB game in the shape the page reads (the RAWG shape), plus thumb/cover
function igdbShape($g, $details = false)
{
    $wide = null;                                     // 16:9-ish artwork, else the first screenshot (always 16:9)
    foreach ($g['artworks'] ?? [] as $a) {
        $w = (int)($a['width'] ?? 0); $h = (int)($a['height'] ?? 0);
        if ($h > 0 && $w / $h >= 1.6 && $w / $h <= 1.9 && $w >= 1280) { $wide = $a['image_id']; break; }
    }
    if (!$wide && !empty($g['screenshots'][0]['image_id'])) $wide = $g['screenshots'][0]['image_id'];
    $genres = [];
    foreach ($g['genres'] ?? [] as $x) if (isset(IGDB_GENRE_MAP[$x['name'] ?? ''])) $genres[] = IGDB_GENRE_MAP[$x['name']];
    foreach ($g['themes'] ?? [] as $x) if (isset(IGDB_THEME_MAP[$x['name'] ?? ''])) $genres[] = IGDB_THEME_MAP[$x['name']];
    $genres = array_slice(array_values(array_unique($genres)), 0, 3);
    $score = null;
    if (!empty($g['aggregated_rating_count'])) $score = (int)round($g['aggregated_rating']);           // critics
    elseif (($g['total_rating_count'] ?? 0) >= 5) $score = (int)round($g['total_rating']);             // critics + users
    $cover = $g['cover']['image_id'] ?? null;
    $out = [
        'id' => $g['id'], 'slug' => 'igdb-' . (int)$g['id'], 'id_source' => 'igdb', 'name' => $g['name'] ?? '',
        'released' => !empty($g['first_release_date']) ? gmdate('Y-m-d', (int)$g['first_release_date']) : null,
        'background_image' => igdbImg('1080p', $wide), 'thumb' => igdbImg('cover_small', $cover), 'cover' => igdbImg('1080p', $cover),
        'metacritic' => $score, 'playtime' => null,
        'platforms' => array_map(fn($p) => ['platform' => ['name' => $p['name'] ?? '']], $g['platforms'] ?? []),
        'genres' => array_map(fn($n) => ['name' => $n], $genres),
        'added' => (int)($g['total_rating_count'] ?? 0) + (int)($g['hypes'] ?? 0),   // popularity, for SmartSort
    ];
    if ($details) $out['description_raw'] = (string)($g['summary'] ?? '');
    return $out;
}
// Search IGDB; adult games (Erotic theme) dropped. Returns RAWG-shaped results, or null on failure.
function igdbSearch($text)
{
    $q = str_replace(['"', '\\'], '', (string)$text);
    $d = igdbQuery('games', 'search "' . $q . '"; fields ' . IGDB_FIELDS . '; where game_type = ' . IGDB_GAME_TYPES
        . ' & version_parent = null; limit 20;');
    if ($d === null) return null;
    $out = [];
    foreach ($d as $g) {
        $erotic = false;
        foreach ($g['themes'] ?? [] as $t) if ((int)($t['id'] ?? 0) === IGDB_EROTIC_THEME) $erotic = true;
        if (!$erotic && !empty($g['id'])) $out[] = igdbShape($g);
    }
    return $out;
}

/**
 * Per-visitor budget for calls that reach RAWG (searches not answered by the cache, the
 * number-swapped second search, game details). Real use stays far below; one script can't
 * spend the site's monthly RAWG quota.
 */
function rawgAllowed()
{
    return !rateLimited('rawg', 30, 600) && !rateLimited('rawgday', 100, 86400);
}
function rawgBusy()
{
    http_response_code(429);
    header('Retry-After: 600');
    echo json_encode(['error' => 'Too many requests']);
    exit;
}
// Only the fields the site uses from a RAWG game (search result or details): a search answer
// drops from ~32 KB to ~2 KB, for the cache and for the visitor's download
function slimRawgGame($g, $details = false)
{
    $out = [
        'id' => $g['id'] ?? null, 'slug' => $g['slug'] ?? '', 'name' => $g['name'] ?? '',
        'released' => $g['released'] ?? null, 'background_image' => $g['background_image'] ?? null,
        'metacritic' => $g['metacritic'] ?? null, 'playtime' => $g['playtime'] ?? null,
        'platforms' => array_map(fn($p) => ['platform' => ['name' => $p['platform']['name'] ?? '']], array_values(array_filter($g['platforms'] ?? [], 'is_array'))),
        'genres' => array_map(fn($x) => ['name' => $x['name'] ?? ''], array_values(array_filter($g['genres'] ?? [], 'is_array'))),
    ];
    if ($details) $out['description_raw'] = $g['description_raw'] ?? '';
    foreach (['thumb', 'cover', 'id_source'] as $k) if (!empty($g[$k])) $out[$k] = $g[$k];   // IGDB extras
    return $out;
}

/**
 * Back-off for outside services (AniList, Jikan, …): after a failure, skip that service for a
 * while instead of making every request wait for its timeout — and, for AniList, instead of
 * hammering it while it has us rate-limited (it allows 30 requests/min per IP in its current
 * degraded mode, answers 429 + a 1-minute timeout, and may block IPs that keep going).
 * State is one small file per service in the temp dir holding the time it may be used again.
 */
function upstreamDown($name)
{
    $until = (int)@file_get_contents(sys_get_temp_dir() . "/cccc-down-$name");
    return $until > time();
}
function upstreamMark($name, $ok, $cooldown = 300)
{
    $f = sys_get_temp_dir() . "/cccc-down-$name";
    $ok ? @unlink($f) : @file_put_contents($f, (string)(time() + $cooldown));
}
// Status code inside fetchUrl()'s wrapped error ("Upstream API returned status 429"), else 0
function upstreamStatus($response)
{
    $d = json_decode((string)$response, true);
    return (is_array($d) && is_string($d['error'] ?? null) && preg_match('/status (\d{3})/', $d['error'], $m)) ? (int)$m[1] : 0;
}

/**
 * Sliding-window rate limit per visitor (hashed address), stored in data/ratelimit/.
 * Returns true when the visitor is over the limit for this bucket.
 */
function rateLimited($bucket, $limit, $windowSec)
{
    global $dataDir;
    $dir = $dataDir . '/ratelimit';
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    // Now and then, drop files of visitors not seen for a day
    if (mt_rand(1, 200) === 1) {
        foreach (glob($dir . '/*') ?: [] as $f) if (@filemtime($f) < time() - 86400) @unlink($f);
    }
    $fh = @fopen($dir . '/' . $bucket . '-' . substr(ipHash(), 0, 32), 'c+');
    if (!$fh) return false;   // never block visitors because the limiter itself failed
    flock($fh, LOCK_EX);
    $now = time();
    $hits = json_decode(stream_get_contents($fh), true);
    $hits = array_values(array_filter(is_array($hits) ? $hits : [], function ($t) use ($now, $windowSec) { return $t > $now - $windowSec; }));
    $limited = count($hits) >= $limit;
    if (!$limited) $hits[] = $now;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($hits));
    flock($fh, LOCK_UN);
    fclose($fh);
    return $limited;
}

function fetchUrl($url, $headers = [], $postData = null, $timeout = 6)
{
    if (empty($url))
        return json_encode(['error' => 'No URL provided']);

    $verifySSL = getenv('APP_ENV') !== 'local';

    if (function_exists('curl_init')) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        // Masquerade as a real browser to prevent blocks
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, min(3, $timeout));   // a host that doesn't answer fails fast
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, $verifySSL);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, $verifySSL ? 2 : false);

        if (!empty($headers)) {
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }
        
        if ($postData !== null) {
            curl_setopt($ch, CURLOPT_POST, 1);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
        }

        $output = curl_exec($ch);
        $error = curl_error($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($output === false) {
            return json_encode(['error' => "CURL Error: $error"]);
        }

        if ($httpCode !== 200) {
            return json_encode([
                'error' => "Upstream API returned status $httpCode",
                'response' => json_decode($output, true) ?: $output
            ]);
        }

        return $output;
    } else {
        $headerStr = "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n";
        if (!empty($headers)) {
            $headerStr .= implode("\r\n", $headers) . "\r\n";
        }
        $opts = [
            'http' => [
                'method'  => $postData !== null ? 'POST' : 'GET',
                'header'  => $headerStr,
                'timeout' => $timeout,
            ],
            'ssl' => [
                'verify_peer'      => $verifySSL,
                'verify_peer_name' => $verifySSL,
            ]
        ];
        if ($postData !== null) {
            $opts['http']['content'] = $postData;
        }
        $context = stream_context_create($opts);
        $output = @file_get_contents($url, false, $context);
        if ($output === false) {
            return json_encode(['error' => 'HTTP request failed']);
        }
        return $output;
    }
}

// --- Configuration ---

loadEnv(__DIR__ . '/.env');

$TMDB_KEY = getenv('TMDB_KEY') ?: '';
$RAWG_KEY = getenv('RAWG_KEY') ?: '';
$STEAMGRIDDB_KEY = getenv('STEAMGRIDDB_KEY') ?: '';
$IGDB_CLIENT_ID = getenv('IGDB_CLIENT_ID') ?: '';
$IGDB_CLIENT_SECRET = getenv('IGDB_CLIENT_SECRET') ?: '';
$DEEPL_KEY = getenv('DEEPL_KEY') ?: '';
$GOOGLE_BOOKS_KEY = getenv('GOOGLE_BOOKS_KEY') ?: ''; // Optional, works without it

// Safety net: no response may ever carry one of our API keys (e.g. inside an upstream
// pagination URL or error message). Every byte we send passes through this filter.
$secrets = array_values(array_filter([$TMDB_KEY, $RAWG_KEY, $STEAMGRIDDB_KEY, $DEEPL_KEY, $GOOGLE_BOOKS_KEY, getenv('DB_PASS') ?: ''],
    function ($s) { return strlen($s) >= 8; }));
if ($secrets) {
    ob_start(function ($buffer) use ($secrets) { return str_replace($secrets, '[redacted]', $buffer); });
}

// --- Main Logic ---

// --- Initialize Data Storage ---
$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) {
    mkdir($dataDir, 0755, true);
}
$logFile = $dataDir . '/classifications.jsonl';

// The rating-guide version every new rating is saved under (column guide_version).
// Raise it by one whenever a guide change alters what a rating means, and add a dated
// entry to the changelog on the About page (about.html, then tools/i18n/build_en.py).
// It is set here, never taken from the request, so a client can't claim another version.
const GUIDE_VERSION = 2;

// type=lookup (per-work consensus) stays off until the public per-work pages are built.
const LOOKUP_ENABLED = false;

$query = isset($_GET['query']) ? $_GET['query'] : '';
$type = isset($_GET['type']) ? $_GET['type'] : '';

// Translate receives its text base64url-encoded in `q` (only A-Z a-z 0-9 _ -, so a
// synopsis with "%", quotes or <> can't trip the WAF). Decode it into $query so the rest
// of the handler is unchanged. Plain ?query= still works as a fallback.
if ($type === 'translate' && isset($_GET['q']) && is_string($_GET['q']) && strlen($_GET['q']) <= 12000) {
    $decoded = base64_decode(strtr($_GET['q'], '-_', '+/'), true);
    if ($decoded !== false && preg_match('//u', $decoded) === 1) $query = $decoded;  // valid UTF-8
}

if (!$type) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing type parameter']);
    exit;
}

// Ensure query is present for API searches
$needsQuery = !in_array($type, ['log', 'stats', 'lookup']);
if (!is_string($query) || !is_string($type) || ($needsQuery && $query === '')) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing query parameter']);
    exit;
}
// Long inputs only make sense for translation (a synopsis) and image URLs
$maxQuery = $type === 'translate' ? 6000 : ($type === 'image_proxy' ? 2048 : 300);
if (strlen($query) > $maxQuery) {
    http_response_code(413);
    echo json_encode(['error' => 'Query too long']);
    exit;
}

// Rate limits per visitor: calls that use our API quotas or fetch from other sites.
// A person searching and making cards stays far below these.
$apiTypes = ['movie', 'tv', 'movie_details', 'tv_details', 'game', 'game_details', 'game_cover', 'hltb',
             'anime', 'manga', 'book', 'book_details', 'translate'];
if ((in_array($type, $apiTypes, true) && rateLimited('api', 240, 600))
    || ($type === 'image_proxy' && rateLimited('img', 100, 600))) {
    http_response_code(429);
    header('Retry-After: 60');
    echo json_encode(['error' => 'Too many requests']);
    exit;
}

// One character ("O", "ا") is just someone starting to type: answer empty, don't spend an
// upstream call (AniList allows 30 a minute for the whole site)
if (in_array($type, SEARCH_TYPES, true) && mb_strlen(trim((string)$query), 'UTF-8') < 2) {
    $key = ['anime' => 'data', 'manga' => 'data', 'book' => 'docs'][$type] ?? 'results';
    echo json_encode([$key => []]);
    exit;
}

// Same search in the last 10 minutes: answer from the cache (see searchCacheGet)
if (in_array($type, SEARCH_TYPES, true) && ($cached = searchCacheGet($type, $query)) !== false) {
    header('X-Search-Cache: HIT');
    header('X-Cache: HIT');
    echo $cached;
    exit;
}

$url = '';

switch ($type) {
    case 'movie':
    case 'tv':
        // Changed language from ar-SA to en-US as requested
        $url = "https://api.themoviedb.org/3/search/$type?api_key=$TMDB_KEY&language=en-US&query=" . urlencode($query) . "&page=1";
        break;

    case 'movie_details':
    case 'tv_details':
        // TMDB ids are numbers; anything else could steer the request to other endpoints
        if (!ctype_digit((string)$query)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid id']);
            exit;
        }
        $url = 'https://api.themoviedb.org/3/' . ($type === 'movie_details' ? 'movie' : 'tv') . "/$query?api_key=$TMDB_KEY&language=en-US";
        break;

    case 'game':
        // RAWG API - comprehensive game database (free and paid games)
        // Fetch 20 to give room for NSFW filtering and smart sorting
        $gameQueries = gameSearchQueries($query);
        // IGDB first (also the number-swapped text when the first search lacks the exact title;
        // IGDB has no monthly cap). Empty or failed -> RAWG below.
        $igdb = igdbSearch($gameQueries[0]);
        if ($igdb !== null && isset($gameQueries[1])) {
            $want = normalizeSearchTitle($query);
            $exact = false;
            foreach ($igdb as $r) if (normalizeSearchTitle($r['name']) === $want) { $exact = true; break; }
            if (!$exact) {
                $alt = igdbSearch($gameQueries[1]);
                if ($alt === null) $searchComplete = false;
                $seen = array_flip(array_column($igdb, 'id'));
                foreach ($alt ?? [] as $r) if (!isset($seen[$r['id']])) { $igdb[] = $r; $seen[$r['id']] = 1; }
            }
        }
        if (!empty($igdb)) {
            header('X-Game-Source: igdb');
            $data = ['results' => $igdb];
            $url = 'IGDB_DONE';
            break;
        }
        header('X-Game-Source: rawg');
        if (!rawgAllowed()) rawgBusy();
        $url = "https://api.rawg.io/api/games?key=$RAWG_KEY&search=" . urlencode($gameQueries[0]) . "&page_size=20";
        break;

    case 'game_details':
        // Fetch detailed game info including description
        // Query must be the game's RAWG slug or numeric id (nothing that changes the path)
        if (!preg_match('/^[a-z0-9-]{1,200}$/i', (string)$query)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid game id']);
            exit;
        }
        $detKey = strtolower((string)$query);
        if (($cached = cacheGet('game_details', $detKey, 604800)) !== false) {
            header('X-Cache: HIT');
            echo $cached;
            exit;
        }
        if (preg_match('/^igdb-(\d{1,10})$/', $detKey, $m)) {
            $d = igdbQuery('games', 'fields ' . IGDB_FIELDS . '; where id = ' . (int)$m[1] . ';');
            if (empty($d[0]['id'])) {
                echo json_encode(['error' => $d === null ? 'Upstream error' : 'Game not found']);
                exit;
            }
            $out = json_encode(slimRawgGame(igdbShape($d[0], true), true));
            cachePut('game_details', $detKey, $out, 604800);
            echo $out;
            exit;
        }
        if (!rawgAllowed()) rawgBusy();
        $raw = json_decode((string)fetchUrl("https://api.rawg.io/api/games/$query?key=$RAWG_KEY"), true);
        if (!is_array($raw) || empty($raw['name'])) {
            echo json_encode(['error' => is_array($raw) && isset($raw['error']) ? 'Upstream error' : 'Game not found']);
            exit;
        }
        $out = json_encode(slimRawgGame($raw, true));
        cachePut('game_details', $detKey, $out, 604800);
        echo $out;
        exit;

    case 'game_cover':
        // SteamGridDB: the chosen cover per game is cached 7 days ("none found" 1 day)
        $coverKey = normalizeSearchTitle($query);
        if (($cached = cacheGet('game_cover', $coverKey, 604800)) !== false) {
            header('X-Cache: HIT');
            echo $cached;
            exit;
        }
        // Search for the game's SteamGridDB id first
        $searchUrl = "https://www.steamgriddb.com/api/v2/search/autocomplete/" . urlencode($query);
        $headers = ["Authorization: Bearer $STEAMGRIDDB_KEY"];

        $searchResponse = fetchUrl($searchUrl, $headers, null, 5);
        $searchData = json_decode($searchResponse, true);

        if ($searchData && isset($searchData['success']) && $searchData['success'] && !empty($searchData['data'])) {
            $gameId = (int)$searchData['data'][0]['id'];
            // Fetch vertical grids (600x900)
            $gridUrl = "https://www.steamgriddb.com/api/v2/grids/game/$gameId?dimensions=600x900&styles=alternate,material,white_logo";
            $grids = json_decode((string)fetchUrl($gridUrl, $headers, null, 5), true);
            if (!is_array($grids) || empty($grids['success'])) {
                echo json_encode(['success' => false, 'error' => 'Upstream error']);   // not cached
                exit;
            }
            $keep = array_map(fn($g) => ['url' => $g['url'] ?? '', 'thumb' => $g['thumb'] ?? '', 'width' => $g['width'] ?? null, 'height' => $g['height'] ?? null],
                              array_slice(array_values(array_filter($grids['data'] ?? [], 'is_array')), 0, 3));
            $out = json_encode(['success' => true, 'data' => $keep]);
            cachePut('game_cover', $coverKey, $out, 604800, $keep ? null : 86400);
            echo $out;
            exit;
        } elseif (is_array($searchData) && !empty($searchData['success'])) {
            $out = json_encode(['success' => false, 'error' => 'Game not found']);
            cachePut('game_cover', $coverKey, $out, 604800, 86400);              // "none found": 1 day
            echo $out;
            exit;
        } else {
            echo json_encode(['success' => false, 'error' => 'Upstream error']);   // not cached
            exit;
        }
        break;

    case 'hltb':
        // HowLongToBeat - search for game completion times
        $result = searchHltb($query);
        if ($result && $result['main_story'] > 0) {
            echo json_encode(['success' => true, 'data' => $result]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Game not found on HLTB']);
        }
        exit;

    case 'image_proxy':
        // Serves the covers the card needs from our own origin, so the export canvas
        // isn't tainted (CORS). It is NOT a general proxy:
        //  - only the image hosts our data sources use (anything else -> 403), so it
        //    can't fetch arbitrary pages or be pointed at internal services;
        //  - every hop (redirects included) is re-checked and the connection is pinned
        //    to the IP that was checked (no DNS-rebinding swap between check and fetch);
        //  - only raster images are passed on, with nosniff and a sandbox CSP, so a
        //    response can never run as a page on muhafid.com;
        //  - TMDB only in the sizes the site uses (w92–w1280): "original" files run to many MB,
        //    and every byte we relay counts against the hosting plan's monthly bandwidth;
        //  - 100 images per visitor per 10 minutes, 10 s timeout and a 5 MB cap.
        if (!function_exists('curl_init')) {
            http_response_code(500);
            echo json_encode(['error' => 'PHP cURL extension is not enabled']);
            exit;
        }
        // Exact host names only (no subdomain wildcards)
        $allowedImageHosts = [
            'image.tmdb.org',                                        // TMDB posters/backdrops
            'media.rawg.io',                                         // RAWG key art
            'cdn2.steamgriddb.com', 'cdn.steamgriddb.com',           // SteamGridDB covers
            'images.igdb.com',                                       // IGDB covers / key art (sizes checked below)
            's4.anilist.co',                                         // AniList covers
            'media.kitsu.app',                                       // Kitsu covers (anime/manga backup)
            'cdn.myanimelist.net',                                   // Jikan / MAL covers
            'covers.openlibrary.org',                                // Open Library covers
            'books.google.com', 'books.googleusercontent.com',       // Google Books thumbnails
        ];
        // Open Library stores its covers on archive.org: covers.openlibrary.org redirects to
        // archive.org/download/<s|m|l>_covers_NNNN/..., which redirects to an iaNNN.us.archive.org
        // server. archive.org is allowed only as part of that chain, never as a starting point,
        // so the proxy can't relay arbitrary archive.org / Wayback Machine content.
        $startHost = '';
        $hostAllowed = function ($host, $path, $hop) use ($allowedImageHosts, &$startHost) {
            $host = strtolower(rtrim((string)$host, '.'));
            if (in_array($host, $allowedImageHosts, true)) return true;
            if ($hop === 0 || $startHost !== 'covers.openlibrary.org') return false;
            if ($host === 'archive.org') return (bool)preg_match('#^/download/[sml]_covers_\d+/#', (string)$path);
            return (bool)preg_match('/^ia\d+\.us\.archive\.org$/', $host);
        };
        // All addresses the host resolves to must be public; returns the one to connect to
        $publicIp = function ($host) {
            $ips = [];
            if (filter_var($host, FILTER_VALIDATE_IP)) {
                $ips[] = $host;
            } else {
                foreach (@dns_get_record($host, DNS_A) ?: [] as $r) if (!empty($r['ip'])) $ips[] = $r['ip'];
                foreach (@dns_get_record($host, DNS_AAAA) ?: [] as $r) if (!empty($r['ipv6'])) $ips[] = $r['ipv6'];
                if (!$ips) $ips = @gethostbynamel($host) ?: [];
            }
            if (!$ips) return null;
            foreach ($ips as $ip) {
                if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) return null;
            }
            foreach ($ips as $ip) if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) return $ip;
            return $ips[0];
        };
        $refuse = function ($code, $msg) {
            http_response_code($code);
            header('Content-Type: text/plain; charset=UTF-8');
            echo $msg;
            exit;
        };

        $url = $query;
        $verifySSL = getenv('APP_ENV') !== 'local';
        $maxBytes = 5 * 1024 * 1024;
        $imageData = null;
        $contentType = '';
        for ($hop = 0; $hop < 4; $hop++) {
            $parts = parse_url($url);
            $scheme = strtolower($parts['scheme'] ?? '');
            $host = $parts['host'] ?? '';
            if (!in_array($scheme, ['http', 'https'], true) || !$host || isset($parts['user']) || isset($parts['pass'])) {
                $refuse(400, 'Invalid image URL.');
            }
            if ($hop === 0) $startHost = strtolower(rtrim($host, '.'));
            if (!$hostAllowed($host, $parts['path'] ?? '', $hop)) $refuse(403, 'Image host not allowed.');
            if ($hop === 0 && strtolower(rtrim($host, '.')) === 'image.tmdb.org'
                && !preg_match('#^/t/p/w(92|154|185|342|500|780|1280)/[A-Za-z0-9_-]+\.(jpg|png|webp)$#', $parts['path'] ?? '')) {
                $refuse(403, 'Image size not allowed.');
            }
            if ($hop === 0 && strtolower(rtrim($host, '.')) === 'images.igdb.com'
                && !preg_match('#^/igdb/image/upload/t_(cover_small|cover_big|cover_big_2x|720p|1080p)/[a-z0-9]+\.(jpg|png|webp)$#', $parts['path'] ?? '')) {
                $refuse(403, 'Image size not allowed.');
            }
            $port = (int)($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
            if (!in_array($port, [80, 443], true)) $refuse(403, 'Image port not allowed.');
            $ip = $publicIp($host);
            if (!$ip) $refuse(403, 'Access to internal networks is forbidden.');

            $ch = curl_init();
            curl_setopt_array($ch, [
                CURLOPT_URL => $url,
                CURLOPT_RESOLVE => ["{$host}:{$port}:" . (strpos($ip, ':') !== false ? "[{$ip}]" : $ip)],
                CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
                CURLOPT_FOLLOWLOCATION => false,           // redirects are followed by this loop, re-checked
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_TIMEOUT => 10,
                CURLOPT_MAXFILESIZE => $maxBytes,
                CURLOPT_NOPROGRESS => false,
                CURLOPT_PROGRESSFUNCTION => function ($c, $dlTotal, $dlNow) use ($maxBytes) { return $dlNow > $maxBytes ? 1 : 0; },
                CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; muhafid.com image proxy)',
                CURLOPT_SSL_VERIFYPEER => $verifySSL,
                CURLOPT_SSL_VERIFYHOST => $verifySSL ? 2 : 0,
            ]);
            $body = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $next = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
            $contentType = strtolower((string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE));
            curl_close($ch);

            if ($code >= 300 && $code < 400 && $next) { $url = $next; continue; }
            if ($code === 200 && $body !== false && $body !== '') $imageData = $body;
            break;
        }

        $mime = trim(explode(';', $contentType)[0]);
        if ($imageData === null) $refuse(404, 'Image not found');
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'], true)) {
            $refuse(415, 'Not an image.');
        }
        header("Content-Type: {$mime}");
        header('X-Content-Type-Options: nosniff');
        header("Content-Security-Policy: default-src 'none'; sandbox");
        header('Cache-Control: public, max-age=86400');
        echo $imageData;
        exit;

    case 'translate':
        $text = $query;
        if (empty($text)) {
            echo json_encode(['error' => 'No text provided']);
            exit;
        }

        // A real Arabic translation contains Arabic letters. Anything else is an error message
        // dressed up as a translation (MyMemory answers "QUERY LENGTH LIMIT EXCEEDED…" with
        // HTTP 200) and must never reach the card.
        $isArabic = fn($t) => is_string($t) && trim($t) !== '' && preg_match('/[\x{0600}-\x{06FF}]/u', $t);
        $ok = function ($t) {
            echo json_encode(['responseStatus' => 200, 'responseData' => ['translatedText' => $t]]);
            exit;
        };

        // 1. Google Translate (client=dict-chrome-ex). A long synopsis takes it 4–6 s from our
        // server, so it gets 10 s: a translation is fetched once per work and cached in the browser.
        $dictUrl = "https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=ar&dt=t&q=" . urlencode($text);
        $data = json_decode(fetchUrl($dictUrl, [], null, 10), true);
        if ($data && isset($data[0]) && is_array($data[0])) {
            $translatedText = '';
            foreach ($data[0] as $segment) {
                if (isset($segment[0])) $translatedText .= $segment[0];
            }
            if ($isArabic($translatedText)) $ok($translatedText);
        }

        // 2. Fallback: MyMemory. It refuses more than 500 characters, so a long text goes in
        // pieces cut at sentence ends (≤ 480 chars each); every piece must come back as Arabic.
        $pieces = [];
        $cur = '';
        foreach (preg_split('/(?<=[.!?…])\s+/u', trim($text)) as $sentence) {
            while (mb_strlen($sentence) > 480) {   // one very long sentence: cut it at a space
                $cut = mb_strrpos(mb_substr($sentence, 0, 480), ' ') ?: 480;
                $pieces[] = trim(($cur !== '' ? $cur . ' ' : '') . mb_substr($sentence, 0, $cut));
                $cur = '';
                $sentence = ltrim(mb_substr($sentence, $cut));
            }
            if ($cur !== '' && mb_strlen($cur) + 1 + mb_strlen($sentence) > 480) { $pieces[] = $cur; $cur = ''; }
            $cur = $cur === '' ? $sentence : $cur . ' ' . $sentence;
        }
        if ($cur !== '') $pieces[] = $cur;
        if (count($pieces) <= 6) {   // MyMemory's free quota is small; very long texts stay English
            $out = [];
            foreach ($pieces as $piece) {
                $mm = json_decode(fetchUrl("https://api.mymemory.translated.net/get?q=" . urlencode($piece) . "&langpair=en|ar", [], null, 5), true);
                $t = $mm['responseData']['translatedText'] ?? null;
                if ((int)($mm['responseStatus'] ?? 0) !== 200 || !$isArabic($t)) { $out = null; break; }
                $out[] = $t;
            }
            if ($out) $ok(implode(' ', $out));
        }

        echo json_encode(['error' => 'Translation failed']);
        exit;

    case 'anime':
    case 'manga':
        // We use AniList as the primary source now, with Jikan as fallback
        $url = 'ANILIST_PRIMARY';
        break;

    case 'book':
        // Open Library API - completely free, no key needed, no rate limits
        $url = "https://openlibrary.org/search.json?q=" . urlencode($query) . "&limit=20";
        break;

    case 'book_details':
        // Open Library work description. Query must be a work key like /works/OL893414W
        if (!preg_match('#^/works/OL\d+W$#', $query)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid work key']);
            exit;
        }
        $work = json_decode(fetchUrl('https://openlibrary.org' . $query . '.json'), true);
        $desc = $work['description'] ?? '';
        if (is_array($desc)) $desc = $desc['value'] ?? '';
        if (is_string($desc) && $desc !== '') {
            $desc = preg_split('/\n-{3,}/', $desc)[0];                 // drop "----------" source/footnote sections
            $desc = preg_replace('/\[([^\]]+)\]\((?:[^)]+)\)/', '$1', $desc); // [text](url) -> text
            $desc = preg_replace('/\[([^\]]+)\]\[\d+\]/', '$1', $desc);     // [text][1] -> text
            $desc = preg_replace('/^\s*\[\d+\]:.*$/m', '', $desc);            // [1]: url lines
            $desc = trim(preg_replace("/\n{3,}/", "\n\n", $desc));
        } else {
            $desc = '';
        }
        echo json_encode(['description' => $desc], JSON_UNESCAPED_UNICODE);
        exit;

    case 'log':
        // Save classification data to MySQL (one vote per IP per work, UPSERT)
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => 'Method not allowed']);
            exit;
        }

        $raw   = file_get_contents('php://input', false, null, 0, 16385);
        if (strlen($raw) > 16384) {   // a real payload is well under 2 KB
            http_response_code(413);
            echo json_encode(['error' => 'Payload too large']);
            exit;
        }
        $input = json_decode($raw, true);
        $validTypes = ['anime', 'manga', 'movie', 'tv', 'game', 'book', 'manual'];
        if (!is_array($input) || !in_array($input['content_type'] ?? null, $validTypes, true) || !isset($input['ratings'])) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid payload']);
            exit;
        }

        // The work's id must look like the ids the site itself sends for that type
        $idPatterns = [
            'anime' => '/^(anilist|kitsu|mal):\d{1,10}$/', 'manga' => '/^(anilist|kitsu|mal):\d{1,10}$/',
            'movie' => '/^\d{1,10}$/', 'tv' => '/^\d{1,10}$/',
            'game'  => '/^[a-z0-9-]{1,200}$/i',
            'book'  => '#^/works/OL\d{1,12}W$#',
            'manual' => '/^manual:.{1,200}$/su',
        ];
        $cid = (string)($input['content_id'] ?? '');
        if (!preg_match($idPatterns[$input['content_type']], $cid)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid content id']);
            exit;
        }

        $pdo = getDB();
        if (!$pdo && getenv('APP_ENV') !== 'local') {
            // Production without a database: refuse rather than write an unbounded file
            http_response_code(503);
            echo json_encode(['error' => 'Storage unavailable']);
            exit;
        }
        if (!$pdo) {
            // Local development only: no database, so keep a JSONL log instead
            $logEntry = [
                'id'           => uniqid(),
                'content_id'   => $input['content_id'] ?? null,
                'content_type' => $input['content_type'],
                'title'        => $input['title'] ?? '',
                'ratings'      => $input['ratings'],
                'badges'       => $input['badges'] ?? [],
                'classifier'   => $input['classifier'] ?? '',
                'rating'       => $input['rating'] ?? '',
                'lang'         => $input['lang'] ?? '',
                'guide_version' => GUIDE_VERSION,
                'custom_synopsis' => !empty($input['custom_synopsis']) ? 1 : 0,
                'synopsis'     => !empty($input['custom_synopsis']) ? ($input['synopsis'] ?? '') : '',
                'orientation'  => $input['orientation'] ?? 'horizontal',
                'action'       => $input['action'] ?? 'export',
                'created_at'   => date('c')
            ];
            file_put_contents($logFile, json_encode($logEntry, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
            echo json_encode(['status' => 'ok', 'storage' => 'jsonl_fallback']);
            exit;
        }

        try {
            // ── 1. Resolve ratings & badges ──────────────────────────────
            $ratings = is_array($input['ratings']) ? $input['ratings'] : [];
            // A level is 0 (absent) or 1–3; anything else counts as absent
            $lvl = function ($k) use ($ratings) { $v = (int)($ratings[$k] ?? 0); return ($v >= 0 && $v <= 3) ? $v : 0; };
            $badges  = is_array($input['badges'])  ? $input['badges']  : [];

            $contentId   = substr((string)($input['content_id'] ?? 'manual'), 0, 255);
            $contentType = $input['content_type'];
            $title       = substr((string)($input['title'] ?? ''), 0, 500);
            $classifier  = substr((string)($input['classifier'] ?? ''), 0, 100);
            $orientation = in_array($input['orientation'] ?? '', ['horizontal','vertical']) ? $input['orientation'] : 'horizontal';
            $action      = in_array($input['action'] ?? '', ['export','copy','rate']) ? $input['action'] : 'export';
            // Classifier's own /10 score (optional) and which site the rating came from
            $rating = null;
            if (isset($input['rating']) && preg_match('/^\d{1,2}(\.\d{1,2})?$/', (string)$input['rating'])) {
                $r = (float)$input['rating'];
                if ($r >= 0 && $r <= 10) $rating = $r;
            }
            $lang = in_array($input['lang'] ?? '', ['ar', 'en'], true) ? $input['lang'] : 'ar';
            // The classifier's own synopsis (only stored when they wrote it): plain text,
            // control characters stripped, capped. Never rendered server-side; escape on display.
            $customSyn = !empty($input['custom_synopsis']) ? 1 : 0;
            $synopsis = null;
            if ($customSyn && isset($input['synopsis']) && is_string($input['synopsis'])) {
                $syn = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', trim($input['synopsis']));
                if ($syn !== '') $synopsis = function_exists('mb_substr') ? mb_substr($syn, 0, 2000) : substr($syn, 0, 4000);
            }

            // Keyed hash of the visitor's address (clientIp: the edge-appended one) — never stored raw
            $ipHash   = ipHash();
            // Once per deploy: an index for the per-visitor lookups below (rate limit, migration).
            // Without it every save scanned the whole table. Guarded: never fails a save.
            $idxFlag = $dataDir . '/.idx_ip_recent';
            if (!is_file($idxFlag)) {
                try {
                    $has = $pdo->query("SHOW INDEX FROM classifications WHERE Key_name = 'idx_ip_recent'")->fetch();
                    if (!$has) $pdo->exec("ALTER TABLE classifications ADD INDEX idx_ip_recent (ip_hash, updated_at)");
                    @touch($idxFlag);
                } catch (PDOException $e) { error_log('CCCC ip index not added: ' . $e->getMessage()); }
            }
            // After IP_HASH_SECRET is set, a returning visitor's old (unkeyed) rows move to the keyed
            // hash the first time they rate again, so nobody is counted twice. IGNORE skips a row
            // that would clash (the same work already saved under the keyed hash).
            $legacyHash = legacyIpHash();
            if ($legacyHash !== $ipHash) {
                $pdo->prepare("UPDATE IGNORE classifications SET ip_hash = ? WHERE ip_hash = ?")->execute([$ipHash, $legacyHash]);
            }

            // Rate limit: at most 30 different works per visitor per 10 minutes
            $recent = $pdo->prepare("SELECT COUNT(*) FROM classifications WHERE ip_hash = ? AND updated_at > (NOW() - INTERVAL 10 MINUTE)");
            $recent->execute([$ipHash]);
            if ((int)$recent->fetchColumn() >= 30) {
                http_response_code(429);
                echo json_encode(['error' => 'Too many requests']);
                exit;
            }

            // ── 2. Upsert the work ───────────────────────────────────────
            // A new work's title comes from its source, by id (canonicalTitle) — never from the
            // browser: the card title is editable and the API can be called directly. An id the
            // source says doesn't exist is refused. Manual entries keep the typed title; if the
            // source can't be reached, the sent title is kept (capped) rather than losing the vote.
            // The title is set once, by the first vote; later voters can't rename a work.
            if ($contentType !== 'manual') {
                $exists = $pdo->prepare("SELECT 1 FROM works WHERE content_id = ? AND content_type = ?");
                $exists->execute([$contentId, $contentType]);
                if (!$exists->fetchColumn()) {
                    $canon = canonicalTitle($contentType, $contentId);
                    if ($canon && !$canon['found']) {
                        http_response_code(400);
                        echo json_encode(['error' => 'Unknown work']);
                        exit;
                    }
                    if ($canon && $canon['title'] !== '') $title = substr($canon['title'], 0, 500);
                }
            }
            $pdo->prepare(
                "INSERT INTO works (content_id, content_type, title)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    updated_at = NOW()"
            )->execute([$contentId, $contentType, $title]);

            // Fetch the work id (works whether it was inserted or already existed)
            $workId = $pdo->query("SELECT LAST_INSERT_ID()")->fetchColumn();
            if (!$workId) {
                $stmt = $pdo->prepare("SELECT id FROM works WHERE content_id = ? AND content_type = ?");
                $stmt->execute([$contentId, $contentType]);
                $workId = $stmt->fetchColumn();
            }

            // ── 3. Upsert the classification (one row per IP per work) ───
            $pdo->prepare(
                "INSERT INTO classifications
                    (work_id, ip_hash,
                     kufr, sex, nudity, vices, magic, lgbt, gore, addiction, lootbox, p2w,
                     badge_nomusic, badge_noprofanity, badge_noaffairs,
                     classifier, orientation, action)
                 VALUES
                    (?, ?,
                     ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?,
                     ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                     kufr             = VALUES(kufr),
                     sex              = VALUES(sex),
                     nudity           = VALUES(nudity),
                     vices            = VALUES(vices),
                     magic            = VALUES(magic),
                     lgbt             = VALUES(lgbt),
                     gore             = VALUES(gore),
                     addiction        = VALUES(addiction),
                     lootbox          = VALUES(lootbox),
                     p2w              = VALUES(p2w),
                     badge_nomusic    = VALUES(badge_nomusic),
                     badge_noprofanity= VALUES(badge_noprofanity),
                     badge_noaffairs  = VALUES(badge_noaffairs),
                     classifier       = VALUES(classifier),
                     orientation      = VALUES(orientation),
                     action           = VALUES(action),
                     updated_at       = NOW()"
            )->execute([
                $workId, $ipHash,
                $lvl('kufr'),
                $lvl('sex'),
                $lvl('nudity'),
                $lvl('vices'),
                $lvl('magic'),
                $lvl('lgbt'),
                $lvl('gore'),
                $lvl('addiction'),
                $lvl('lootbox'),
                $lvl('p2w'),
                !empty($badges['nomusic'])     ? 1 : 0,
                !empty($badges['noprofanity']) ? 1 : 0,
                !empty($badges['noaffairs'])   ? 1 : 0,
                $classifier, $orientation, $action
            ]);

            // ── 4. Classifier /10 score, site language, synopsis ─────────
            // Set by a follow-up UPDATE so a write still succeeds before the migration in
            // data/schema.sql is run — if the columns don't exist yet, the catch ignores it
            // (SQLSTATE 42S22 = unknown column) and the rest of the save is unaffected.
            $setExtra = "UPDATE classifications SET classifier_rating = ?, lang = ?, custom_synopsis = ?, synopsis = ?
                         WHERE work_id = ? AND ip_hash = ?";
            $extraVals = [$rating, $lang, $customSyn, $synopsis, $workId, $ipHash];
            try {
                $pdo->prepare($setExtra)->execute($extraVals);
            } catch (PDOException $e) {
                if ($e->getCode() !== '42S22') throw $e;   // only tolerate "column not added yet"
                // Columns missing — add them automatically (needs ALTER privilege on the DB user).
                // Runs once; afterwards the UPDATE above just succeeds. If the user can't ALTER,
                // the rating already saved without these fields, so nothing is lost.
                foreach ([
                    'classifier_rating DECIMAL(4,2) DEFAULT NULL',
                    'lang CHAR(2) DEFAULT NULL',
                    'custom_synopsis TINYINT(1) DEFAULT 0',
                    'synopsis TEXT DEFAULT NULL',
                ] as $col) {
                    try { $pdo->exec("ALTER TABLE classifications ADD COLUMN $col"); } catch (PDOException $e2) {}
                }
                try { $pdo->prepare($setExtra)->execute($extraVals); } catch (PDOException $e3) {}
            }

            // ── 4b. Rating-guide version (GUIDE_VERSION, set server-side) ─
            // Its own UPDATE and its own auto-migration, so if this column can't be added
            // the score/language/synopsis above still save exactly as before.
            $setGuide = "UPDATE classifications SET guide_version = ? WHERE work_id = ? AND ip_hash = ?";
            try {
                $pdo->prepare($setGuide)->execute([GUIDE_VERSION, $workId, $ipHash]);
            } catch (PDOException $e) {
                // The rating itself is already saved: never fail the request over this column
                if ($e->getCode() === '42S22') {   // column not there yet: add it once
                    try {
                        $pdo->exec("ALTER TABLE classifications ADD COLUMN guide_version SMALLINT UNSIGNED DEFAULT NULL");
                        // Every rating saved before this column existed was made under guide v1.
                        $pdo->exec("UPDATE classifications SET guide_version = 1 WHERE guide_version IS NULL");
                    } catch (PDOException $e2) {}
                    try { $pdo->prepare($setGuide)->execute([GUIDE_VERSION, $workId, $ipHash]); } catch (PDOException $e3) {}
                } else {
                    error_log('CCCC guide_version not saved: ' . $e->getMessage());
                }
            }

            // ── 5. Sync rater_count (unique IPs who rated this work) ─────
            $pdo->prepare(
                "UPDATE works
                 SET rater_count = (SELECT COUNT(*) FROM classifications WHERE work_id = ?),
                     updated_at  = NOW()
                 WHERE id = ?"
            )->execute([$workId, $workId]);

            echo json_encode(['status' => 'ok', 'work_id' => (int)$workId, 'storage' => 'mysql']);

        } catch (PDOException $e) {
            error_log('CCCC log error: ' . $e->getMessage());
            http_response_code(500);
            echo json_encode(['error' => 'Database error']);
        }
        exit;

    case 'stats':
        // Return aggregate stats — from MySQL if available, JSONL fallback
        $pdo = getDB();

        if ($pdo) {
            try {
                $totalRaters = (int)$pdo->query("SELECT SUM(rater_count) FROM works")->fetchColumn();
                $totalWorks  = (int)$pdo->query("SELECT COUNT(*) FROM works WHERE rater_count > 0")->fetchColumn();
                $byType = [];
                foreach ($pdo->query("SELECT content_type, SUM(rater_count) as cnt FROM works GROUP BY content_type") as $row) {
                    $byType[$row['content_type']] = (int)$row['cnt'];
                }
                $top = [];
                foreach ($pdo->query("SELECT title, content_type, rater_count FROM works WHERE content_type <> 'manual' ORDER BY rater_count DESC LIMIT 10") as $row) {
                    $top[] = $row;
                }
                $out = [
                    'total_raters' => $totalRaters,
                    'total_works'  => $totalWorks,
                    'by_type'      => $byType,
                    'top_works'    => $top,
                    'source'       => 'mysql'
                ];
                // The classifier /10 score + language — only once the columns exist (added
                // automatically on the first rating save). Guarded so stats works before then.
                try {
                    $r = $pdo->query("SELECT COUNT(classifier_rating) AS scored, ROUND(AVG(classifier_rating), 2) AS avg_score FROM classifications")->fetch();
                    $out['scored_count'] = (int)$r['scored'];
                    $out['avg_score']    = $r['avg_score'] !== null ? (float)$r['avg_score'] : null;
                    $byLang = [];
                    foreach ($pdo->query("SELECT lang, COUNT(*) AS cnt FROM classifications WHERE lang IS NOT NULL GROUP BY lang") as $row) {
                        $byLang[$row['lang']] = (int)$row['cnt'];
                    }
                    $out['by_lang'] = $byLang;
                    $out['custom_synopses'] = (int)$pdo->query("SELECT COUNT(*) FROM classifications WHERE custom_synopsis = 1")->fetchColumn();
                } catch (PDOException $e) { /* columns not added yet */ }
                // Ratings per guide version (separate guard: this column arrives later)
                $out['guide_version'] = GUIDE_VERSION;
                try {
                    $byGuide = [];
                    foreach ($pdo->query("SELECT guide_version, COUNT(*) AS cnt FROM classifications WHERE guide_version IS NOT NULL GROUP BY guide_version") as $row) {
                        $byGuide['v' . (int)$row['guide_version']] = (int)$row['cnt'];
                    }
                    $out['by_guide_version'] = $byGuide;
                } catch (PDOException $e) { /* column not added yet */ }
                echo json_encode($out);
            } catch (PDOException $e) {
                error_log('CCCC stats error: ' . $e->getMessage());
                echo json_encode(['error' => 'Database error']);
            }
        } else {
            // Fallback: read from JSONL
            if (!file_exists($logFile)) {
                echo json_encode(['total_raters' => 0, 'by_type' => [], 'source' => 'jsonl']);
                exit;
            }
            $lines    = file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            $byType   = [];
            $byAction = [];
            foreach ($lines as $line) {
                $entry = json_decode($line, true);
                if ($entry) {
                    $t = $entry['content_type'] ?? 'unknown';
                    $a = $entry['action']       ?? 'export';
                    $byType[$t]   = ($byType[$t]   ?? 0) + 1;
                    $byAction[$a] = ($byAction[$a] ?? 0) + 1;
                }
            }
            echo json_encode([
                'total_raters' => count($lines),
                'by_type'      => $byType,
                'by_action'    => $byAction,
                'source'       => 'jsonl'
            ]);
        }
        exit;

    case 'lookup':
        // Consensus ratings for one work, kept for the future per-work pages. Switched off
        // until those pages exist: no page uses it, and it would let anyone harvest every
        // work's ratings. When re-enabling, keep it to totals (no names, no individual rows)
        // and add a per-IP rate limit like `log`.
        if (!LOOKUP_ENABLED) {
            http_response_code(404);
            echo json_encode(['error' => 'Not available']);
            exit;
        }
        // Usage: proxy.php?type=lookup&query=CONTENT_ID&content_type=anime
        $lookupId   = $query;
        $lookupType = is_string($_GET['content_type'] ?? null) ? $_GET['content_type'] : '';

        if (!$lookupId || !$lookupType) {
            http_response_code(400);
            echo json_encode(['error' => 'Missing query or content_type']);
            exit;
        }

        $pdo = getDB();
        if (!$pdo) {
            echo json_encode(['found' => false, 'reason' => 'db_unavailable']);
            exit;
        }

        try {
            $stmt = $pdo->prepare("SELECT * FROM works WHERE content_id = ? AND content_type = ?");
            $stmt->execute([$lookupId, $lookupType]);
            $work = $stmt->fetch();

            if (!$work || (int)$work['rater_count'] === 0) {
                echo json_encode(['found' => false]);
                exit;
            }

            $workId     = $work['id'];
            $totalCount = (int)$work['rater_count'];
            $categories = ['kufr','sex','nudity','vices','magic','lgbt','gore','addiction','lootbox','p2w'];
            $consensus  = [];
            $scoreTotal = 0;

            // Majority vote (mode) per category — presence threshold 30%
            foreach ($categories as $cat) {
                $stmt = $pdo->prepare(
                    "SELECT `{$cat}` AS level, COUNT(*) AS votes
                     FROM classifications
                     WHERE work_id = ? AND `{$cat}` > 0
                     GROUP BY `{$cat}`
                     ORDER BY votes DESC, `{$cat}` ASC
                     LIMIT 1"
                );
                $stmt->execute([$workId]);
                $row = $stmt->fetch();

                if ($row && ($row['votes'] / $totalCount) >= 0.30) {
                    $level = (int)$row['level'];
                    $pts   = $level === 1 ? 3 : ($level === 2 ? 2 : 1);
                    $consensus[$cat] = [
                        'level'   => $level,
                        'votes'   => (int)$row['votes'],
                        'percent' => round(($row['votes'] / $totalCount) * 100) . '%'
                    ];
                    $scoreTotal += $pts;
                }
            }

            // Badge consensus
            $badgeKeys = ['badge_nomusic','badge_noprofanity','badge_noaffairs'];
            $badgeOut  = [];
            foreach ($badgeKeys as $badge) {
                $stmt = $pdo->prepare(
                    "SELECT COUNT(*) AS cnt FROM classifications WHERE work_id = ? AND `{$badge}` = 1"
                );
                $stmt->execute([$workId]);
                $cnt = (int)$stmt->fetchColumn();
                if ($cnt > 0 && ($cnt / $totalCount) >= 0.30) {
                    $key = str_replace('badge_', '', $badge);
                    $badgeOut[$key] = [
                        'count'   => $cnt,
                        'percent' => round(($cnt / $totalCount) * 100) . '%'
                    ];
                }
            }

            echo json_encode([
                'found'           => true,
                'work'            => [
                    'title'        => $work['title'],
                    'content_type' => $work['content_type'],
                    'content_id'   => $work['content_id'],
                    'rater_count'  => $totalCount
                ],
                'consensus'       => $consensus,
                'badges'          => $badgeOut,
                'severity_score'  => $scoreTotal
            ], JSON_UNESCAPED_UNICODE);

        } catch (PDOException $e) {
            error_log('CCCC lookup error: ' . $e->getMessage());
            http_response_code(500);
            echo json_encode(['error' => 'Database error']);
        }
        exit;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid type']);
        exit;
}

function fetchAniListFallback($query, $type) {
    $format = $type === 'anime' ? 'ANIME' : 'MANGA';
    
    // GraphQL query to fetch exact fields needed and automatically filter NSFW (isAdult: false).
    // The search text goes in as a variable, never spliced into the query itself.
    $graphql = 'query ($search: String) {
      Page(page: 1, perPage: 20) {
        media(search: $search, type: ' . $format . ', isAdult: false, sort: POPULARITY_DESC) {
          id
          title { romaji english }
          coverImage { extraLarge large }
          description
          averageScore
          episodes
          chapters
          volumes
          genres
        }
      }
    }';

    $payload = json_encode(['query' => $graphql, 'variables' => ['search' => (string)$query]]);
    $headers = [
        'Content-Type: application/json',
        'Accept: application/json'
    ];

    if (upstreamDown('anilist')) return ['error' => 'AniList cooling down'];
    $response = fetchUrl('https://graphql.anilist.co', $headers, $payload, 3);
    $anilistData = json_decode($response, true);

    if (!$anilistData || isset($anilistData['error'])) {
        // 429 = AniList's rate limit (1-minute timeout); anything else = down/slow for now
        upstreamMark('anilist', false, upstreamStatus($response) === 429 ? 65 : 30);
        return ['error' => $anilistData['error'] ?? 'AniList API Error'];
    }
    upstreamMark('anilist', true);

    $jikanFormat = ['data' => []];

    if (isset($anilistData['data']['Page']['media'])) {
        foreach ($anilistData['data']['Page']['media'] as $item) {
            $jikanFormat['data'][] = [
                'mal_id' => $item['id'], // NOTE: this is an AniList ID, not a MAL ID — see id_source
                'id_source' => 'anilist',
                'title' => !empty($item['title']['english']) ? $item['title']['english'] : (!empty($item['title']['romaji']) ? $item['title']['romaji'] : 'Unknown Title'),
                'title_english' => $item['title']['english'] ?? '',
                'images' => [
                    'jpg' => [
                        'image_url' => $item['coverImage']['large'] ?? '',
                        'small_image_url' => $item['coverImage']['large'] ?? '',
                        'large_image_url' => $item['coverImage']['extraLarge'] ?? ''
                    ]
                ],
                'synopsis' => strip_tags($item['description'] ?? ''),
                'score' => isset($item['averageScore']) ? ($item['averageScore'] / 10) : 0,
                'episodes' => $item['episodes'] ?? 0,
                'chapters' => $item['chapters'] ?? 0,
                'volumes' => $item['volumes'] ?? 0,
                'genres' => array_map(function($g) { return ['name' => $g]; }, $item['genres'] ?? []),
                'members' => 0 // Fallback for SmartSort
            ];
        }
    }
    
    return $jikanFormat;
}

/**
 * Kitsu search (backup when AniList fails), normalized to the same shape as AniList/Jikan
 * results. Free, no key. Adult titles are dropped (nsfw flag or R18 age rating).
 */
const KITSU_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Romance',
    'Science Fiction', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller', 'Psychological', 'Mecha',
    'Music', 'Historical', 'Military', 'Martial Arts', 'Samurai', 'Magic', 'School', 'Space', 'Super Power',
    'Mahou Shoujo', 'Shounen', 'Shoujo', 'Seinen', 'Josei', 'Isekai', 'Police', 'Crime', 'Detective',
    'Post Apocalypse', 'Cyberpunk', 'Parody', 'Kids'];
function fetchKitsu($query, $type) {
    if (upstreamDown('kitsu')) return ['error' => 'Kitsu cooling down'];
    $url = "https://kitsu.io/api/edge/$type?filter%5Btext%5D=" . urlencode($query)
         . '&page%5Blimit%5D=20&include=categories&fields%5Bcategories%5D=title';
    $response = fetchUrl($url, ['Accept: application/vnd.api+json'], null, 4);
    $d = json_decode($response, true);
    if (!is_array($d) || !isset($d['data']) || !is_array($d['data'])) {
        upstreamMark('kitsu', false, 30);
        return ['error' => 'Kitsu API Error'];
    }
    upstreamMark('kitsu', true);

    $catName = [];
    foreach ($d['included'] ?? [] as $inc) {
        if (($inc['type'] ?? '') === 'categories') $catName[$inc['id']] = $inc['attributes']['title'] ?? '';
    }
    $out = ['data' => []];
    foreach ($d['data'] as $item) {
        $a = $item['attributes'] ?? [];
        if (!empty($a['nsfw']) || ($a['ageRating'] ?? '') === 'R18') continue;
        $title = ($a['titles']['en'] ?? '') ?: (($a['canonicalTitle'] ?? '') ?: ($a['titles']['en_jp'] ?? 'Unknown Title'));
        // Kitsu "categories" mix genres with loose tags ("Earth", "Slavery"): keep real genres only
        $genres = [];
        foreach ($item['relationships']['categories']['data'] ?? [] as $c) {
            $name = $catName[$c['id'] ?? ''] ?? '';
            if ($name !== '' && in_array($name, KITSU_GENRES, true)) $genres[] = ['name' => $name];
            if (count($genres) >= 5) break;
        }
        $poster = $a['posterImage'] ?? [];
        $out['data'][] = [
            'mal_id' => (int)$item['id'],          // a Kitsu id — see id_source
            'id_source' => 'kitsu',
            'title' => $title,
            'title_english' => $a['titles']['en'] ?? '',
            'images' => ['jpg' => [
                'image_url' => $poster['small'] ?? ($poster['medium'] ?? ''),
                'small_image_url' => $poster['small'] ?? ($poster['medium'] ?? ''),
                'large_image_url' => $poster['large'] ?? ($poster['original'] ?? ''),
            ]],
            'synopsis' => strip_tags($a['synopsis'] ?? ''),
            'score' => isset($a['averageRating']) ? round((float)$a['averageRating'] / 10, 2) : 0,
            'episodes' => $a['episodeCount'] ?? 0,
            'chapters' => $a['chapterCount'] ?? 0,
            'volumes' => $a['volumeCount'] ?? 0,
            'genres' => $genres,
            'members' => $a['userCount'] ?? 0,   // popularity, for SmartSort
        ];
    }
    return $out;
}

if ($url === 'IGDB_DONE') {
    // $data already holds IGDB's results (see case 'game'); filters + SmartSort run below
} else if ($url === 'ANILIST_PRIMARY') {
    // --- REVERSED WATERFALL: ANILIST FIRST ---
    $data = fetchAniListFallback($query, $type);
    
    // If AniList fails, times out, or returns 0 results: Kitsu, then Jikan
    if (!$data || isset($data['error']) || empty($data['data'])) {
        $kitsu = fetchKitsu($query, $type);
        if (!isset($kitsu['error']) && !empty($kitsu['data'])) {
            error_log("CCCC Warning: AniList failed or empty, answered by Kitsu for: $query");
            $data = $kitsu;
            $response = json_encode($data);
        } elseif (upstreamDown('jikan')) {
            // Jikan failed in the last 5 minutes: don't wait on it again
            $data = ['data' => []];
            $response = json_encode($data);
        } else {
            error_log("CCCC Warning: AniList GraphQL failed or returned empty. Falling back to Jikan API for: $query");
            $jikanUrl = "https://api.jikan.moe/v4/$type?q=" . urlencode($query) . "&limit=20&genres_exclude=12";
            $response = fetchUrl($jikanUrl, [], null, 3);
            $data = json_decode($response, true);
            upstreamMark('jikan', is_array($data) && isset($data['data']) && is_array($data['data']), 300);
        }
    } else {
        $response = json_encode($data);
    }
} else if ($url) {
    $response = fetchUrl($url);
    $data = json_decode($response, true);
    // Games: also search the number-swapped text ("6" <-> "VI") and merge, de-duplicated by id.
    // Skipped when the first search already has the exact title (tested: the second one then
    // only adds spin-offs). If it was needed but failed or was over budget, the answer is
    // cached 10 min instead of 24 h.
    $searchComplete = $searchComplete ?? true;
    $exactFirst = false;
    if ($type === 'game' && isset($gameQueries[1]) && is_array($data) && isset($data['results']) && is_array($data['results'])) {
        $want = normalizeSearchTitle($query);
        foreach ($data['results'] as $r) if (normalizeSearchTitle($r['name'] ?? '') === $want) { $exactFirst = true; break; }
    }
    if ($type === 'game' && isset($gameQueries[1]) && !$exactFirst && is_array($data) && isset($data['results']) && is_array($data['results'])) {
        $alt = rawgAllowed() ? json_decode(fetchUrl("https://api.rawg.io/api/games?key=$RAWG_KEY&search=" . urlencode($gameQueries[1]) . "&page_size=20", [], null, 5), true) : null;
        if (!is_array($alt) || !isset($alt['results']) || !is_array($alt['results'])) $searchComplete = false;
        if (is_array($alt) && isset($alt['results']) && is_array($alt['results'])) {
            $seen = array_flip(array_column($data['results'], 'id'));
            foreach ($alt['results'] as $r) {
                if (isset($r['id']) && !isset($seen[$r['id']])) { $data['results'][] = $r; $seen[$r['id']] = 1; }
            }
        }
    }
} else {
    echo json_encode(['error' => 'Unknown error']);
    exit;
}

if (isset($data) && $data && !isset($data['error'])) {
    // 1. Run safety & logic filters
    if ($type === 'tv' || $type === 'movie') {
        $data = filterAnimeFromTMDB($data);
    } else if ($type === 'game') {
        $data = filterNSFWFromRAWG($data);
        // RAWG pagination URLs embed our API key (?key=...) — never pass them to the client
        unset($data['next'], $data['previous']);
    }
    
    // 2. Apply Smart Sort (Applies to ALL 6 types)
    if (in_array($type, ['movie', 'tv', 'game', 'anime', 'manga', 'book'])) {
        $data = applySmartSort($data, $type, $query);
    }
    if ($type === 'game' && isset($data['results']) && is_array($data['results'])) {
        $data = ['results' => array_map('slimRawgGame', $data['results'])];
    }

    $response = json_encode($data);
}

if (in_array($type, SEARCH_TYPES, true) && isset($response)) searchCachePut($type, $query, $response, $searchComplete ?? true);
echo $response ?? json_encode(['error' => 'Unknown error']);
