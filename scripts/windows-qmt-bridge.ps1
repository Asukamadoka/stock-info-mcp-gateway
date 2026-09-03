[CmdletBinding()]
param(
  [switch]$AllowQuickTunnelForDiagnostic
)

$ErrorActionPreference = "Stop"
$LocalEndpoint = "http://127.0.0.1:18765/mcp"
$ProtocolVersion = "2026-07-28"
$Token = [Environment]::GetEnvironmentVariable("QMT_MCP_TOKEN", "Process")
if ([string]::IsNullOrWhiteSpace($Token)) {
  $Token = [Environment]::GetEnvironmentVariable("QMT_MCP_TOKEN", "User")
}
$PublicUrl = [Environment]::GetEnvironmentVariable("QMT_PUBLIC_URL", "Process")
if ([string]::IsNullOrWhiteSpace($PublicUrl)) {
  $PublicUrl = [Environment]::GetEnvironmentVariable("QMT_PUBLIC_URL", "User")
}

if ([string]::IsNullOrWhiteSpace($Token)) { throw "QMT_MCP_TOKEN is not configured in the Windows environment." }
if ([string]::IsNullOrWhiteSpace($PublicUrl)) { throw "QMT_PUBLIC_URL is not configured in the Windows environment." }

$publicUri = [Uri]$PublicUrl
if ($publicUri.Scheme -ne "https") { throw "QMT_PUBLIC_URL must use https:// in production." }
if ($publicUri.Query -or $publicUri.Fragment) { throw "QMT_PUBLIC_URL must not contain query or fragment data." }
if ($publicUri.Host.EndsWith("trycloudflare.com", [StringComparison]::OrdinalIgnoreCase) -and -not $AllowQuickTunnelForDiagnostic) {
  throw "Quick Tunnel host is diagnostic-only. Use a stable production hostname, or explicitly pass AllowQuickTunnelForDiagnostic for a temporary smoke."
}

function Invoke-QmtProbe {
  param(
    [Parameter(Mandatory=$true)][string]$Uri,
    [Parameter(Mandatory=$true)][string]$Label
  )
  $requestId = [Guid]::NewGuid().ToString()
  $headers = @{
    "Authorization" = "Bearer $Token"
    "Accept" = "application/json, text/event-stream"
    "Content-Type" = "application/json"
    "mcp-protocol-version" = $ProtocolVersion
    "mcp-method" = "tools/call"
    "mcp-name" = "qmt_capabilities"
  }
  $body = @{
    jsonrpc = "2.0"
    id = $requestId
    method = "tools/call"
    params = @{
      name = "qmt_capabilities"
      arguments = @{}
      _meta = @{ request_id = $requestId; stateless = $true }
    }
  } | ConvertTo-Json -Depth 8 -Compress
  try {
    $response = Invoke-RestMethod -Method Post -Uri $Uri -Headers $headers -Body $body -TimeoutSec 15
  } catch {
    throw "$Label probe failed without exposing endpoint or bearer details."
  }
  if ($null -eq $response -or $null -eq $response.result) { throw "$Label probe returned no MCP result." }
  return $true
}

$LocalProbe = Invoke-QmtProbe -Uri $LocalEndpoint -Label "local"
$PublicProbe = Invoke-QmtProbe -Uri $publicUri.AbsoluteUri -Label "public"

[PSCustomObject]@{
  status = "ready"
  local_probe = [bool]$LocalProbe
  public_probe = [bool]$PublicProbe
  protocol = $ProtocolVersion
  quick_tunnel_diagnostic = $publicUri.Host.EndsWith("trycloudflare.com", [StringComparison]::OrdinalIgnoreCase)
  checked_at = [DateTimeOffset]::UtcNow.ToString("o")
} | ConvertTo-Json -Compress
