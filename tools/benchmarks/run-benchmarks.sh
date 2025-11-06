#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         🚀 LimitRate Performance Benchmarks                    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}❌ k6 is not installed${NC}"
    echo -e "${YELLOW}Install k6: https://k6.io/docs/get-started/installation/${NC}"
    echo ""
    echo "macOS: brew install k6"
    echo "Linux: snap install k6"
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${RED}❌ jq is not installed${NC}"
    echo -e "${YELLOW}Install jq: brew install jq (macOS) or apt-get install jq (Linux)${NC}"
    exit 1
fi

# Navigate to benchmarks directory
cd "$(dirname "$0")"

# Create results directory
mkdir -p results

# Function to start server and wait for health check
start_server() {
    local library=$1
    local store=$2
    local port=${3:-3000}

    echo -e "${CYAN}Starting server: $library with $store store...${NC}"

    LIBRARY=$library STORE=$store PORT=$port node test-server.js &
    SERVER_PID=$!

    # Wait for server to be ready
    for i in {1..30}; do
        if curl -s http://localhost:$port/health > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Server ready${NC}"
            return 0
        fi
        sleep 0.5
    done

    echo -e "${RED}✗ Server failed to start${NC}"
    kill $SERVER_PID 2>/dev/null || true
    return 1
}

# Function to stop server
stop_server() {
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
        sleep 1
    fi
}

# Function to run k6 test and extract metrics
run_k6_test() {
    local test_file=$1
    local output_file=$2

    k6 run --out json=$output_file --quiet $test_file
}

# Function to extract metrics from k6 JSON output
extract_metrics() {
    local json_file=$1

    # Extract key metrics
    local p50=$(cat $json_file | jq '[.metrics.http_req_duration.values | select(. != null) | .p50] | .[0] // 0')
    local p95=$(cat $json_file | jq '[.metrics.http_req_duration.values | select(. != null) | .p95] | .[0] // 0')
    local p99=$(cat $json_file | jq '[.metrics.http_req_duration.values | select(. != null) | .p99] | .[0] // 0')
    local rps=$(cat $json_file | jq '[.metrics.http_reqs.values | select(. != null) | .rate] | .[0] // 0')

    echo "$p50|$p95|$p99|$rps"
}

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  📊 Benchmark 1: LimitRate - Memory Store${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

start_server "limitrate" "memory" 3000
run_k6_test "k6-load-test.js" "results/limitrate-memory.json"
LIMITRATE_MEMORY_METRICS=$(extract_metrics "results/limitrate-memory.json")
stop_server

echo -e "${GREEN}✓ LimitRate (Memory) benchmark complete${NC}"
echo ""

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  📊 Benchmark 2: express-rate-limit - Memory Store${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

start_server "express-rate-limit" "memory" 3000
run_k6_test "k6-load-test.js" "results/express-rate-limit-memory.json"
EXPRESS_MEMORY_METRICS=$(extract_metrics "results/express-rate-limit-memory.json")
stop_server

echo -e "${GREEN}✓ express-rate-limit (Memory) benchmark complete${NC}"
echo ""

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  📊 Benchmark 3: rate-limiter-flexible - Memory Store${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

start_server "rate-limiter-flexible" "memory" 3000
run_k6_test "k6-load-test.js" "results/rate-limiter-flexible-memory.json"
RLF_MEMORY_METRICS=$(extract_metrics "results/rate-limiter-flexible-memory.json")
stop_server

echo -e "${GREEN}✓ rate-limiter-flexible (Memory) benchmark complete${NC}"
echo ""

# Redis benchmarks (optional - only if Redis is available)
if curl -s redis://localhost:6379 > /dev/null 2>&1 || nc -z localhost 6379 2>/dev/null; then
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  📊 Benchmark 4: LimitRate - Redis Store${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""

    start_server "limitrate" "redis" 3000
    run_k6_test "k6-load-test.js" "results/limitrate-redis.json"
    LIMITRATE_REDIS_METRICS=$(extract_metrics "results/limitrate-redis.json")
    stop_server

    echo -e "${GREEN}✓ LimitRate (Redis) benchmark complete${NC}"
    echo ""
else
    echo -e "${YELLOW}⚠ Redis not available, skipping Redis benchmarks${NC}"
    LIMITRATE_REDIS_METRICS="0|0|0|0"
fi

# Throughput test (LimitRate only)
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  📊 Benchmark 5: Throughput Test (LimitRate)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

start_server "limitrate" "memory" 3000
run_k6_test "k6-throughput-test.js" "results/limitrate-throughput.json"
LIMITRATE_THROUGHPUT=$(extract_metrics "results/limitrate-throughput.json")
stop_server

echo -e "${GREEN}✓ Throughput benchmark complete${NC}"
echo ""

# Generate results table
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║               📊 BENCHMARK RESULTS SUMMARY                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Parse metrics
IFS='|' read -r LR_MEM_P50 LR_MEM_P95 LR_MEM_P99 LR_MEM_RPS <<< "$LIMITRATE_MEMORY_METRICS"
IFS='|' read -r ERL_MEM_P50 ERL_MEM_P95 ERL_MEM_P99 ERL_MEM_RPS <<< "$EXPRESS_MEMORY_METRICS"
IFS='|' read -r RLF_MEM_P50 RLF_MEM_P95 RLF_MEM_P99 RLF_MEM_RPS <<< "$RLF_MEMORY_METRICS"
IFS='|' read -r LR_REDIS_P50 LR_REDIS_P95 LR_REDIS_P99 LR_REDIS_RPS <<< "$LIMITRATE_REDIS_METRICS"
IFS='|' read -r LR_TP_P50 LR_TP_P95 LR_TP_P99 LR_TP_RPS <<< "$LIMITRATE_THROUGHPUT"

# Display table
printf "${CYAN}%-35s %10s %10s %10s %12s${NC}\n" "Library" "p50 (ms)" "p95 (ms)" "p99 (ms)" "req/s"
echo "─────────────────────────────────────────────────────────────────────────"
printf "%-35s %10.2f %10.2f %10.2f %12.0f\n" "LimitRate (Memory)" $LR_MEM_P50 $LR_MEM_P95 $LR_MEM_P99 $LR_MEM_RPS
printf "%-35s %10.2f %10.2f %10.2f %12.0f\n" "express-rate-limit (Memory)" $ERL_MEM_P50 $ERL_MEM_P95 $ERL_MEM_P99 $ERL_MEM_RPS
printf "%-35s %10.2f %10.2f %10.2f %12.0f\n" "rate-limiter-flexible (Memory)" $RLF_MEM_P50 $RLF_MEM_P95 $RLF_MEM_P99 $RLF_MEM_RPS

if [ "$LIMITRATE_REDIS_METRICS" != "0|0|0|0" ]; then
    printf "%-35s %10.2f %10.2f %10.2f %12.0f\n" "LimitRate (Redis)" $LR_REDIS_P50 $LR_REDIS_P95 $LR_REDIS_P99 $LR_REDIS_RPS
fi

echo ""
echo -e "${CYAN}Throughput Test (60s, 1000 VUs):${NC}"
printf "%-35s %10.2f %10.2f %10.2f %12.0f\n" "LimitRate (Memory)" $LR_TP_P50 $LR_TP_P95 $LR_TP_P99 $LR_TP_RPS

echo ""
echo -e "${GREEN}✅ All benchmarks complete!${NC}"
echo ""
echo -e "${YELLOW}Results saved to:${NC}"
echo "  • results/limitrate-memory.json"
echo "  • results/express-rate-limit-memory.json"
echo "  • results/rate-limiter-flexible-memory.json"
if [ "$LIMITRATE_REDIS_METRICS" != "0|0|0|0" ]; then
    echo "  • results/limitrate-redis.json"
fi
echo "  • results/limitrate-throughput.json"
echo ""
