<?php
/**
 * CCCC Clean URL Router
 * This script intercepts 404 requests (like /guide) and natively serves 
 * the corresponding .html file (like guide.html) without redirecting the URL.
 */

// Security headers for every response this script serves.
// CSP: scripts only from this site and cdnjs (html2canvas, pinned with SRI) — NO inline
// script unless the page lists its exact SHA-256 (see cspFor() below: the HTML pages get
// the hashes of their own inline scripts, the import map included); WebAssembly for the
// JPEG encoder; images from anywhere over HTTPS (search thumbnails come straight from
// TMDB, RAWG, AniList...); fetch() only to this site (proxy.php); no framing by other sites.
function cspFor($scriptHashes = [])
{
    $hashes = $scriptHashes ? ' ' . implode(' ', array_map(fn($h) => "'sha256-$h'", $scriptHashes)) : '';
    return "default-src 'self'; "
        . "script-src 'self'$hashes 'wasm-unsafe-eval' https://cdnjs.cloudflare.com; "
        . "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        . "font-src 'self' https://fonts.gstatic.com data:; "
        . "img-src 'self' data: blob: https:; "
        . "connect-src 'self' data: blob:; "
        . "worker-src 'self' blob:; "
        . "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";
}

// SHA-256 (base64) of every inline script that runs: classic scripts and the import map.
// JSON-LD and other data blocks don't execute, so they need no hash.
function inlineScriptHashes($html)
{
    preg_match_all('#<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>#s', $html, $m, PREG_SET_ORDER);
    $out = [];
    foreach ($m as $s) {
        if (preg_match('#type="(?!importmap|module|text/javascript)[^"]*"#i', $s[1])) continue;
        $out[] = base64_encode(hash('sha256', $s[2], true));
    }
    return array_values(array_unique($out));
}

header('Content-Security-Policy: ' . cspFor());

// Short fingerprint of a file's content, for ?v= (changes only when the file does)
function contentVersion($path)
{
    return substr(hash_file('sha256', $path) ?: (string)@filemtime($path), 0, 10);
}
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: SAMEORIGIN');
header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
header_remove('X-Powered-By');
// Pages are revalidated on every visit; this also stops a ?v= on a page URL from being
// pinned in the edge cache by the server's long-cache rule for versioned files.
header('Cache-Control: no-cache');

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Remove the leading slash
$file = ltrim($path, '/');

// Default to index if root is requested
if ($file === '') {
    $file = 'index';
}

// The page files live at the top level (Arabic) and in lang/en/ (English, generated
// by tools/i18n/build_en.py); lang/ is only reached through the clean URLs below.
$english = ($file === 'en' || strpos($file, 'en/') === 0);
if (strpos($file, 'lang/') === 0) {
    $file = '';   // -> 404
} elseif ($english) {
    // /en/ and /en/about/ -> /en and /en/about: the pages' links assume no trailing slash
    if ($file !== 'en' && substr($file, -1) === '/') {
        $clean = '/' . rtrim($file, '/');
        $query = parse_url($_SERVER['REQUEST_URI'], PHP_URL_QUERY);
        header('Location: ' . $clean . ($query ? '?' . $query : ''), true, 301);
        exit;
    }
    // English pages: /en, /en/about, /en/guide
    $page = $file === 'en' ? 'index' : substr($file, 3);
    $file = in_array($page, ['index', 'about', 'guide'], true) ? 'lang/en/' . $page : '';
}

// Pages (and the 404 page) answer GET and HEAD only; proxy.php has its own method rules.
if ($file !== 'proxy.php' && !in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    http_response_code(405);
    header('Allow: GET, HEAD');
    exit;
}

// Check if the corresponding .html file exists
if ($file !== '' && file_exists($file . '.html')) {
    // Return standard 200 OK and serve the HTML content
    http_response_code(200);

    // The finished page (versioned URLs + import map below) is the same for every
    // visitor until the next deploy, so it is built once and kept in the temp dir
    // instead of re-stat'ing ~50 files and walking js/ on every page view.
    // Each deploy is a fresh build: every file gets the build time as its mtime (all
    // ?v= values match), so this file's and the page's mtimes identify the deploy.
    // The TTL is only a safety net in case a deploy ever keeps old mtimes.
    // Skipped on the PHP dev server, so local edits show up at once.
    $cacheFile = null;
    if (PHP_SAPI !== 'cli-server') {
        $cacheDir = sys_get_temp_dir() . '/cccc-pages';
        $stamp = filemtime(__FILE__) . '-' . filemtime($file . '.html');
        $cacheFile = $cacheDir . '/' . str_replace('/', '_', $file) . '-' . $stamp . '.html';
        $age = @filemtime($cacheFile);
        if ($age !== false && time() - $age < 600 && ($cached = @file_get_contents($cacheFile)) !== false) {
            header('Content-Security-Policy: ' . cspFor(inlineScriptHashes($cached)));
            echo $cached;
            exit;
        }
    }

    $html = file_get_contents($file . '.html');

    // Cache busting: every local file the page references gets ?v=<fingerprint of its
    // content>. Caddy lets browsers keep any ?v= URL for a year (see Caddyfile). It is the
    // content, not the modified time, because every deploy re-stamps every file: with
    // times, each deploy made browsers download everything again (fonts included — the
    // brief flash of the fallback font after a deploy). Now only changed files get new URLs.
    // assets/fonts/ is left as-is: the <link rel="preload"> URLs must match style.v3.css's
    // url(...) exactly (fonts get their own long cache in the Caddyfile).
    $html = preg_replace_callback(
        '/\b(href|src)="(?!https?:|\/\/|data:|#|mailto:)([^"?#]+\.(?:css|js|png|jpe?g|svg|ico|webp|gif|woff2?|ttf))(?:\?[^"]*)?"/',
        function ($m) {
            $path = ltrim($m[2], '/');
            if (strpos($path, 'assets/fonts/') === 0 || !is_file($path)) return $m[0];
            return $m[1] . '="' . $m[2] . '?v=' . contentVersion($path) . '"';
        },
        $html
    );

    // Modules import each other by plain path ('./ui.js'), which the rewrite above
    // can't reach. An import map points each module path at its versioned URL.
    if (strpos($html, '<script type="module"') !== false) {
        $imports = [];
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator('js', FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->isFile() && substr($f->getFilename(), -3) === '.js') {
                $p = '/' . str_replace('\\', '/', $f->getPathname());
                $imports[$p] = $p . '?v=' . contentVersion($f->getPathname());
            }
        }
        ksort($imports);
        $map = '<script type="importmap">' . json_encode(['imports' => $imports], JSON_UNESCAPED_SLASHES) . '</script>';
        $html = preg_replace('/<script type="module"/', $map . "\n    " . '<script type="module"', $html, 1);
    }

    // Best effort: if the temp dir isn't writable the page is simply built each time.
    // Written to a temp name and renamed, so a reader never sees a half-written page.
    if ($cacheFile !== null && (is_dir($cacheDir) || @mkdir($cacheDir, 0700, true))) {
        $prefix = $cacheDir . '/' . str_replace('/', '_', $file) . '-';
        foreach (glob($prefix . '*.html') ?: [] as $old) {
            if ($old !== $cacheFile) @unlink($old);   // earlier deploys' copies
        }
        $tmp = $cacheFile . '.' . getmypid() . '.' . mt_rand() . '.tmp';
        if (@file_put_contents($tmp, $html) === strlen($html)) {
            @rename($tmp, $cacheFile) || @unlink($tmp);
        } else {
            @unlink($tmp);
        }
    }

    header('Content-Security-Policy: ' . cspFor(inlineScriptHashes($html)));
    echo $html;
    exit;
}

// If it's a proxy request or something else that slipped through, don't interfere
if ($file === 'proxy.php') {
    include 'proxy.php';
    exit;
}

// If no file matches, return a clean 404
http_response_code(404);
if ($english) {
?>
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8">
    <title>404 – Page not found</title>
    <style>
        body { background: #0e1014; color: #fff; font-family: monospace; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .error { text-align: center; }
        h1 { color: #c8ff5e; font-size: 48px; }
        a { color: #fff; text-decoration: none; border-bottom: 1px solid #c8ff5e; }
    </style>
</head>
<body>
    <div class="error">
        <h1>404</h1>
        <p>Sorry, this page could not be found.</p>
        <a href="/en">Back to home</a>
    </div>
</body>
</html>
<?php
    exit;
}
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>404 - الصفحة غير موجودة</title>
    <style>
        body { background: #0e1014; color: #fff; font-family: monospace; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .error { text-align: center; }
        h1 { color: #c8ff5e; font-size: 48px; }
        a { color: #fff; text-decoration: none; border-bottom: 1px solid #c8ff5e; }
    </style>
</head>
<body>
    <div class="error">
        <h1>404</h1>
        <p>عذرا، الصفحة غير موجودة.</p>
        <a href="/">العودة إلى الرئيسية</a>
    </div>
</body>
</html>
