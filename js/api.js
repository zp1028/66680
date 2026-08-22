// API 模块：带熔断器的 HTTP 请求

const CircuitBreakerState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open',
};

class CircuitBreaker {
  constructor(name, failureThreshold = null, recoveryTimeout = null) {
    this.name = name;
    this.failureThreshold = failureThreshold || Settings.circuitFailureThreshold;
    this.recoveryTimeout = recoveryTimeout || Settings.circuitRecoveryTimeout;
    this.state = CircuitBreakerState.CLOSED;
    this.failures = 0;
    this.lastFailureTime = null;
  }
  
  canExecute() {
    if (this.state === CircuitBreakerState.CLOSED) return true;
    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = CircuitBreakerState.HALF_OPEN;
        return true;
      }
      return false;
    }
    return true; // HALF_OPEN
  }
  
  recordSuccess() {
    this.failures = 0;
    this.state = CircuitBreakerState.CLOSED;
  }
  
  recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
    }
  }
}

const apiBreaker = new CircuitBreaker('api_primary');
const apiAltBreaker = new CircuitBreaker('api_alt');

// 带超时的 fetch
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

// 安全 JSON 请求
async function safeJsonGet(url, timeout = null, retries = null) {
  timeout = timeout || Settings.apiTimeoutRead;
  retries = retries || Settings.apiRetries;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (!apiBreaker.canExecute()) return null;
    
    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
        },
        mode: 'cors',
      }, timeout);
      
      if (!response.ok) throw new Error('HTTP ' + response.status);
      
      const data = await response.json();
      apiBreaker.recordSuccess();
      return data;
    } catch (e) {
      apiBreaker.recordFailure();
      if (attempt >= retries) return null;
      await new Promise(r => setTimeout(r, 350 * Math.pow(2, attempt)));
    }
  }
  return null;
}

// 解析 API 时间
function parseApiTime(s) {
  if (s === null || s === undefined || s === '') return null;
  
  if (typeof s === 'number') {
    let ts = s;
    if (ts > 1e12) ts /= 1000;
    const d = new Date(ts * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  
  const text = String(s).trim();
  if (/^\d+$/.test(text)) {
    let ts = parseFloat(text);
    if (ts > 1e12) ts /= 1000;
    const d = new Date(ts * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  
  const formats = [
    '%Y-%m-%d %H:%M:%S',
    '%Y-%m-%d %H:%M',
    '%Y/%m/%d %H:%M:%S',
  ];
  
  // Try JS Date parsing first
  const d = new Date(text);
  if (!isNaN(d.getTime())) return d;
  
  // Manual parsing for common formats
  const m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) {
    const d2 = new Date(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6] || '0')
    );
    if (!isNaN(d2.getTime())) return d2;
  }
  
  return null;
}
