/**
 * AdaptiveOps E2E Test Suite - Assertions Library
 */

export class AssertionError extends Error {
  constructor(message, expected, actual) {
    super(message);
    this.name = 'AssertionError';
    this.expected = expected;
    this.actual = actual;
  }
}

export function assertEqual(actual, expected, message = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    const msg = message || `Expected ${expectedStr} but received ${actualStr}`;
    throw new AssertionError(msg, expected, actual);
  }
}

export function assertNotEqual(actual, expected, message = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    const msg = message || `Expected value NOT to equal ${expectedStr}`;
    throw new AssertionError(msg, `NOT ${expectedStr}`, actual);
  }
}

export function assertTrue(value, message = '') {
  if (value !== true) {
    const msg = message || `Expected true but received ${JSON.stringify(value)}`;
    throw new AssertionError(msg, true, value);
  }
}

export function assertFalse(value, message = '') {
  if (value !== false) {
    const msg = message || `Expected false but received ${JSON.stringify(value)}`;
    throw new AssertionError(msg, false, value);
  }
}

export function assertStatus(response, expectedStatus, message = '') {
  const status = response.status !== undefined ? response.status : response.statusCode;
  if (status !== expectedStatus) {
    const msg = message || `Expected HTTP status ${expectedStatus} but received ${status}`;
    throw new AssertionError(msg, expectedStatus, status);
  }
}

export function assertStatusIn(response, allowedStatuses, message = '') {
  const status = response.status !== undefined ? response.status : response.statusCode;
  if (!allowedStatuses.includes(status)) {
    const msg = message || `Expected HTTP status in [${allowedStatuses.join(', ')}] but received ${status}`;
    throw new AssertionError(msg, allowedStatuses, status);
  }
}

export function assertHeader(response, headerName, expectedValue, message = '') {
  const headers = response.headers;
  let actualValue = null;
  if (headers && typeof headers.get === 'function') {
    actualValue = headers.get(headerName);
  } else if (headers && headers[headerName.toLowerCase()]) {
    actualValue = headers[headerName.toLowerCase()];
  } else if (headers && headers[headerName]) {
    actualValue = headers[headerName];
  }

  if (expectedValue instanceof RegExp) {
    if (!expectedValue.test(actualValue || '')) {
      const msg = message || `Header "${headerName}" (${actualValue}) does not match regex ${expectedValue}`;
      throw new AssertionError(msg, expectedValue.toString(), actualValue);
    }
  } else if (actualValue !== expectedValue) {
    const msg = message || `Expected header "${headerName}" to be "${expectedValue}", got "${actualValue}"`;
    throw new AssertionError(msg, expectedValue, actualValue);
  }
}

export function assertIncludes(haystack, needle, message = '') {
  if (typeof haystack === 'string') {
    if (!haystack.includes(needle)) {
      const msg = message || `Expected string to contain "${needle}"`;
      throw new AssertionError(msg, `contains "${needle}"`, haystack);
    }
  } else if (Array.isArray(haystack)) {
    if (!haystack.includes(needle)) {
      const msg = message || `Expected array to contain element`;
      throw new AssertionError(msg, `contains element`, haystack);
    }
  } else if (haystack && typeof haystack === 'object') {
    if (!(needle in haystack)) {
      const msg = message || `Expected object to contain property "${needle}"`;
      throw new AssertionError(msg, `property "${needle}"`, Object.keys(haystack));
    }
  } else {
    throw new AssertionError(`Unsupported haystack type: ${typeof haystack}`);
  }
}

export function assertMatches(str, regex, message = '') {
  if (!regex.test(str)) {
    const msg = message || `Expected "${str}" to match regex ${regex}`;
    throw new AssertionError(msg, regex.toString(), str);
  }
}

export async function assertThrowsAsync(asyncFn, expectedMessageOrType = null, message = '') {
  let threw = false;
  let caughtError = null;
  try {
    await asyncFn();
  } catch (err) {
    threw = true;
    caughtError = err;
  }
  if (!threw) {
    const msg = message || 'Expected async function to throw an error, but it succeeded';
    throw new AssertionError(msg, 'error thrown', 'no error');
  }
  if (expectedMessageOrType) {
    if (typeof expectedMessageOrType === 'string' && !caughtError.message.includes(expectedMessageOrType)) {
      throw new AssertionError(
        `Expected error message containing "${expectedMessageOrType}", got "${caughtError.message}"`,
        expectedMessageOrType,
        caughtError.message
      );
    }
    if (expectedMessageOrType instanceof RegExp && !expectedMessageOrType.test(caughtError.message)) {
      throw new AssertionError(
        `Expected error message matching ${expectedMessageOrType}, got "${caughtError.message}"`,
        expectedMessageOrType.toString(),
        caughtError.message
      );
    }
  }
}
