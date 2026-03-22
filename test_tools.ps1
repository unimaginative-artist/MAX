$body = @{
    name = 'vision_scan'
    args = @{
        source = 'screen'
    }
} | ConvertTo-Json

Write-Host "Sending: $body"

$response = Invoke-WebRequest -Uri 'http://localhost:3001/api/tools/execute' -Method POST -ContentType 'application/json' -Body $body
Write-Host "Response:"
$response.Content