#!/bin/bash

echo "Testing LimitRate Rate Limiting..."
echo "=================================="
echo ""

echo "📊 Test 1: Free user hitting /api/data (limit: 10 req/min)"
echo "Sending 15 requests..."
echo ""

for i in {1..15}; do
  response=$(curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3001/api/data)
  http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d: -f2)
  body=$(echo "$response" | sed '/HTTP_CODE/d')

  if [ "$http_code" == "200" ]; then
    echo "✅ Request #$i: SUCCESS"
  elif [ "$http_code" == "429" ]; then
    echo "🚫 Request #$i: RATE LIMITED (429)"
    echo "   Response: $(echo $body | jq -c '.message')"
  fi
done

echo ""
echo "📊 Test 2: Pro user hitting /api/data (limit: 100 req/min)"
echo "Sending 15 requests..."
echo ""

for i in {1..15}; do
  response=$(curl -s -w "\nHTTP_CODE:%{http_code}" -H "x-user-plan: pro" http://localhost:3001/api/data)
  http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d: -f2)

  if [ "$http_code" == "200" ]; then
    echo "✅ Request #$i: SUCCESS (Pro)"
  elif [ "$http_code" == "429" ]; then
    echo "🚫 Request #$i: RATE LIMITED"
  fi
done

echo ""
echo "✨ Done!"
