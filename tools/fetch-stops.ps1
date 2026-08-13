<#
  이음(EEUM) — 울산 BIS 정류장 데이터 내려받기

  울산광역시 BIS OpenAPI에서 정류장 3,000여 개(좌표 포함)를 받아
  data/stops.json 으로 저장합니다.

  왜 미리 받아두나요?
      발표장에서 실시간 API를 부르면 네트워크가 느릴 때 화면이 멈춥니다.
      정류장 목록은 자주 바뀌지 않으므로 미리 받아 앱에 넣어둡니다.
      (실시간으로 필요한 건 '도착정보'뿐이고, 그건 Worker가 처리합니다)

  실행 방법:
      powershell -ExecutionPolicy Bypass -File tools\fetch-stops.ps1 -ServiceKey "발급받은_Decoding_키"

  ⚠️ 인증키를 이 파일에 적어넣지 마세요. 실행할 때 인자로만 넘기세요.
     (적어두면 git에 그대로 올라갑니다)
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$ServiceKey,

  # 울주군 일대만 남기려면 $true. 전체 울산을 받으려면 $false.
  [bool]$UljuOnly = $true
)

$ErrorActionPreference = 'Stop'
$base = 'http://openapi.its.ulsan.kr/UlsanAPI'
$outDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'data'
$outFile = Join-Path $outDir 'stops.json'

New-Item -ItemType Directory -Force $outDir | Out-Null

Write-Host ""
Write-Host "  울산 BIS 정류장 데이터 내려받기" -ForegroundColor Cyan
Write-Host "  --------------------------------------------"

$all = @()
$pageNo = 1
$numOfRows = 500

while ($true) {
  $url = "$base/BusStopInfo.xo?pageNo=$pageNo&numOfRows=$numOfRows&serviceKey=$ServiceKey"
  Write-Host ("  요청 중... page " + $pageNo) -ForegroundColor DarkGray

  try {
    $res = Invoke-WebRequest -Uri $url -TimeoutSec 30 -UseBasicParsing
  } catch {
    Write-Host ("  요청 실패: " + $_.Exception.Message) -ForegroundColor Red
    break
  }

  $xml = $res.Content

  # 게이트웨이 에러 확인
  if ($xml -match '<resultMsg>([^<]*(?:NOT REGISTERED|INVALID|ERROR)[^<]*)</resultMsg>') {
    Write-Host ""
    Write-Host ("  API 오류: " + $Matches[1]) -ForegroundColor Red
    Write-Host "  → data.go.kr 마이페이지에서 '울산광역시_BIS정보' 활용신청이" -ForegroundColor Yellow
    Write-Host "    승인 상태인지 확인해주세요. 방금 신청했다면 반영에 시간이 걸립니다." -ForegroundColor Yellow
    exit 1
  }

  # <row> 블록 파싱
  $rows = [regex]::Matches($xml, '(?s)<row>(.*?)</row>')
  if ($rows.Count -eq 0) { break }

  foreach ($r in $rows) {
    $block = $r.Groups[1].Value
    $get = {
      param($tag)
      $m = [regex]::Match($block, "<$tag>(.*?)</$tag>", 'Singleline')
      if ($m.Success) { $m.Groups[1].Value.Trim() } else { $null }
    }

    $lat = & $get 'STOPY'
    $lng = & $get 'STOPX'
    $latD = 0.0; $lngD = 0.0

    if ([double]::TryParse($lat, [ref]$latD) -and [double]::TryParse($lng, [ref]$lngD)) {
      # 울산 대략 범위 밖 좌표는 버림 (데이터 오류 방어)
      if ($latD -gt 35.2 -and $latD -lt 35.8 -and $lngD -gt 128.9 -and $lngD -lt 129.5) {
        $all += [pscustomobject]@{
          id   = & $get 'STOPID'
          name = & $get 'STOPNAME'
          lat  = [math]::Round($latD, 6)
          lng  = [math]::Round($lngD, 6)
        }
      }
    }
  }

  $total = 0
  if ($xml -match '<totalCnt>(\d+)</totalCnt>') { $total = [int]$Matches[1] }

  Write-Host ("     누적 " + $all.Count + " / " + $total) -ForegroundColor DarkGray

  if ($all.Count -ge $total -or $rows.Count -lt $numOfRows) { break }
  $pageNo++
  if ($pageNo -gt 40) { break }  # 무한루프 방지
}

if ($all.Count -eq 0) {
  Write-Host "  받은 정류장이 없습니다. 인증키를 확인해주세요." -ForegroundColor Red
  exit 1
}

# 울주군 일대만 (마실고래버스 운행권역 대략 범위)
$filtered = $all
if ($UljuOnly) {
  $filtered = $all | Where-Object {
    $_.lat -gt 35.35 -and $_.lat -lt 35.72 -and $_.lng -gt 128.98 -and $_.lng -lt 129.40
  }
  Write-Host ("  울주군 권역 필터: " + $all.Count + " -> " + $filtered.Count) -ForegroundColor DarkGray
}

$payload = [pscustomobject]@{
  source      = 'ulsan-bis-openapi'
  generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
  count       = $filtered.Count
  stops       = $filtered
}

$json = $payload | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($outFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host ("  완료: " + $filtered.Count + "개 정류장 저장") -ForegroundColor Green
Write-Host ("  파일: " + $outFile)
Write-Host ""
