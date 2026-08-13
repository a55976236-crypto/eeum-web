<#
  이음(EEUM) — 로컬 미리보기 서버

  Node.js도 Python도 필요 없습니다. PowerShell만으로 정적 파일을 띄웁니다.

  실행 방법:
      powershell -ExecutionPolicy Bypass -File tools\serve.ps1

  그다음 브라우저에서:
      http://localhost:8080

  왜 파일을 그냥 더블클릭하면 안 되나요?
      file:// 로 열면 브라우저가 위치·마이크 권한을 막습니다.
      localhost 는 '보안 컨텍스트'로 취급되어 실제 배포 환경과 똑같이 테스트할 수 있습니다.

  끄는 방법: 이 창에서 Ctrl+C
#>

param(
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'

# 이 스크립트의 상위 폴더(= eeum-web)를 문서 루트로 씁니다.
$root = Split-Path -Parent $PSScriptRoot
Write-Host ""
Write-Host "  이음(EEUM) 로컬 서버" -ForegroundColor Cyan
Write-Host "  --------------------------------------------"
Write-Host "  폴더 : $root"
Write-Host "  주소 : http://localhost:$Port" -ForegroundColor Green
Write-Host "  종료 : Ctrl+C"
Write-Host ""

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.webmanifest' = 'application/manifest+json'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
  $listener.Start()
} catch {
  Write-Host "  포트 $Port 를 열 수 없습니다. 다른 포트로 시도해보세요:" -ForegroundColor Red
  Write-Host "     powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8081"
  exit 1
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    # URL 경로 -> 실제 파일 경로
    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
    $path = Join-Path $root ($rel -replace '/', '\')

    # 상위 폴더 탈출 차단
    $full = [System.IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root))) {
      $res.StatusCode = 403; $res.Close(); continue
    }

    if (Test-Path -LiteralPath $full -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-store')   # 수정하면 바로 반영되도록
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("  200  " + $rel) -ForegroundColor DarkGray
    } else {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
      $res.OutputStream.Write($msg, 0, $msg.Length)
      Write-Host ("  404  " + $rel) -ForegroundColor Yellow
    }

    $res.Close()
  } catch {
    # 브라우저가 연결을 먼저 끊는 건 정상이므로 무시하고 계속 대기
  }
}
