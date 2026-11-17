<?php
/**
 * CCCC Clean URL Router
 * This script intercepts 404 requests (like /guide) and natively serves 
 * the corresponding .html file (like guide.html) without redirecting the URL.
 */

// Security headers for every page this script serves.
// CSP: scripts only from this site (inline ones included: the scale script, the import
// map) and cdnjs (html2canvas, pinned with SRI); WebAssembly for the JPEG encoder; images
// from anywhere over HTTPS (search thumbnails come straight from TMDB, RAWG, AniList...);
// fetch() only to this site (proxy.php); no framing by other sites.
header("Content-Security-Policy: default-src 'self'; "
    . "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com; "
    . "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    . "font-src 'self' https://fonts.gstatic.com data:; "
    . "img-src 'self' data: blob: https:; "
    . "connect-src 'self' data: blob:; "
    . "worker-src 'self' blob:; "
    . "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'");
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: SAMEORIGIN');
header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
header('Strict-Transport-Security: max-age=31536000');
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

// Check if the corresponding .html file exists
if ($file !== '' && file_exists($file . '.html')) {
    // Return standard 200 OK and serve the HTML content
    http_response_code(200);
    $html = file_get_contents($file . '.html');

    // Cache busting: every local file the page references gets ?v=<last modified>.
    // Caddy lets browsers keep any ?v= URL for a year (see Caddyfile), so each
    // deploy changes the URLs of exactly the files that changed.
    $html = preg_replace_callback(
        '/\b(href|src)="(?!https?:|\/\/|data:|#|mailto:)([^"?#]+\.(?:css|js|png|jpe?g|svg|ico|webp|gif|woff2?|ttf))(?:\?[^"]*)?"/',
        function ($m) {
            $path = ltrim($m[2], '/');
            if (!is_file($path)) return $m[0];
            return $m[1] . '="' . $m[2] . '?v=' . filemtime($path) . '"';
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
                $imports[$p] = $p . '?v=' . $f->getMTime();
            }
        }
        ksort($imports);
        $map = '<script type="importmap">' . json_encode(['imports' => $imports], JSON_UNESCAPED_SLASHES) . '</script>';
        $html = preg_replace('/<script type="module"/', $map . "\n    " . '<script type="module"', $html, 1);
    }

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
