#!/bin/bash

# LimitRate Express Basic Example - Test Script
# This script tests rate limiting for free, pro, and enterprise plans

set -e

BASE_URL="http://localhost:3001"
PASSED=0
FAILED=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 LimitRate Express Basic - Test Suite"
echo "========================================"
echo ""

# Helper function to test endpoint
test_endpoint() {
  local name="$1"
  local expected="$2"
  local cmd="$3"

  echo -n "Testing: $name... "

  if eval "$cmd" > /dev/null 2>&1; then
    if [ "$expected" = "success" ]; then
      echo -e "${GREEN}✓ PASSED${NC}"
      ((PASSED++))
    else
      echo -e "${RED}✗ FAILED${NC} (expected failure but got success)"
      ((FAILED++))
    fi
  else
    if [ "$expected" = "fail" ]; then
      echo -e "${GREEN}✓ PASSED${NC}"
      ((PASSED++))
    else
      echo -e "${RED}✗ FAILED${NC} (expected success but got failure)"
      ((FAILED++))
    fi
  fi
}

# Test 1: Server is running
echo -e "${YELLOW}Test Group 1: Basic Connectivity${NC}"
test_endpoint "Server responds to /" "success" "curl -s -f $BASE_URL/"
test_endpoint "GET /api/data responds" "success" "curl -s -f $BASE_URL/api/data"
test_endpoint "GET /api/hello responds" "success" "curl -s -f $BASE_URL/api/hello"
echo ""

# Test 2: Free plan rate limits
echo -e "${YELLOW}Test Group 2: Free Plan Rate Limiting (10 req/min)${NC}"

# Make 10 requests (should all succeed)
success_count=0
for i in {1..10}; do
  if curl -s -f "$BASE_URL/api/data" > /dev/null 2>&1; then
    ((success_count++))
  fi
done

if [ $success_count -eq 10 ]; then
  echo -e "${GREEN}✓ PASSED${NC} First 10 requests succeeded"
  ((PASSED++))
else
  echo -e "${RED}✗ FAILED${NC} Expected 10 successful requests, got $success_count"
  ((FAILED++))
fi

# 11th request should fail
sleep 0.5
if ! curl -s -f "$BASE_URL/api/data" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ PASSED${NC} 11th request blocked (429)"
  ((PASSED++))
else
  echo -e "${RED}✗ FAILED${NC} 11th request should have been blocked"
  ((FAILED++))
fi

# Wait for rate limit to reset
echo "⏳ Waiting 60 seconds for rate limit reset..."
sleep 60

echo ""

# Test 3: Pro plan rate limits
echo -e "${YELLOW}Test Group 3: Pro Plan Rate Limiting (100 req/min)${NC}"

# Pro users should handle more requests
pro_success=0
for i in {1..50}; do
  if curl -s -f -H "x-user-plan: pro" "$BASE_URL/api/data" > /dev/null 2>&1; then
    ((pro_success++))
  fi
done

if [ $pro_success -eq 50 ]; then
  echo -e "${GREEN}✓ PASSED${NC} Pro plan handled 50 requests"
  ((PASSED++))
else
  echo -e "${RED}✗ FAILED${NC} Pro plan only handled $pro_success/50 requests"
  ((FAILED++))
fi

echo ""

# Test 4: Enterprise plan
echo -e "${YELLOW}Test Group 4: Enterprise Plan (allow-and-log)${NC}"

ent_success=0
for i in {1..200}; do
  if curl -s -f -H "x-user-plan: enterprise" "$BASE_URL/api/data" > /dev/null 2>&1; then
    ((ent_success++))
  fi
done

if [ $ent_success -eq 200 ]; then
  echo -e "${GREEN}✓ PASSED${NC} Enterprise plan never blocks"
  ((PASSED++))
else
  echo -e "${RED}✗ FAILED${NC} Enterprise plan only handled $ent_success/200 requests"
  ((FAILED++))
fi

echo ""

# Test 5: Rate limit headers
echo -e "${YELLOW}Test Group 5: Rate Limit Headers${NC}"

headers=$(curl -s -I "$BASE_URL/api/hello")

if echo "$headers" | grep -q "RateLimit-Limit:"; then
  echo -e "${GREEN}✓ PASSED${NC} RateLimit-Limit header present"
  ((PASSED++))
else
  echo -e "${RED}✗ FAILED${NC} RateLimit-Limit header missing"
  ((FAILED++))
fi

if echo "$headers" | grep -q "RateLimit-Remaining:"; then
  echo -e "${GREEN}✓ PASSED${NC} RateLimit-Remaining header present"
  ((PASSED++))
else
  echo -e "${RED}✗ FAILED${NC} RateLimit-Remaining header missing"
  ((FAILED++))
fi

if echo "$headers" | grep -q "RateLimit-Reset:"; then
  echo -e "${GREEN}✓ PASSED${NC} RateLimit-Reset header present"
  ((PASSED++))
else
  echo -e "${RED}✗ FAILED${NC} RateLimit-Reset header missing"
  ((FAILED++))
fi

echo ""
echo "========================================"
echo "Test Results:"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo "========================================"

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}✗ Some tests failed${NC}"
  exit 1
fi
