/**
 * Looker Studio Community Connector for Monstera Cloud
 * Version: 2.1.0
 * Updated: April 2026
 *
 * Dimensions : date, platform, accountId, accountName,
 *              campaignId, campaignName, adsetId, adsetName, currency
 * Raw metrics : impressions, clicks, spend, reach, conversions, revenue
 *
 * Derived ratios (CPC, CTR, CPM, ROAS) are intentionally excluded — add them
 * as Calculated Fields in your report so aggregations stay mathematically correct:
 *   CPC  = Spend / Clicks
 *   CTR  = Clicks / Impressions
 *   CPM  = (Spend / Impressions) * 1000
 *   ROAS = Revenue / Spend
 */

var cc = DataStudioApp.createCommunityConnector();
var APP_URL = "https://monsteracloud.com";
var DEFAULT_CACHE_TTL_SECONDS = 600; // 10 minutes
var MAX_ROWS_PER_REQUEST = 100000; // Prevent runaway requests
var FETCH_RETRY_COUNT = 3;
var FETCH_RETRY_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getAuthType() {
  var AuthTypes = cc.AuthType;
  return cc
    .newAuthTypeResponse()
    .setAuthType(AuthTypes.KEY)
    .setHelpUrl(APP_URL + "/looker-studio")
    .build();
}

function resetAuth() {
  PropertiesService.getUserProperties().deleteProperty("ds.key");
}

/** Lightweight ping — avoids fetching campaign rows on every auth refresh. */
function pingMonsteraWithKey(key) {
  if (!key || !key.trim()) return 401;
  try {
    var response = UrlFetchApp.fetch(APP_URL + "/api/looker-studio?ping=1", {
      headers: { Authorization: "Bearer " + key.trim() },
      muteHttpExceptions: true,
    });
    return response.getResponseCode();
  } catch (e) {
    return 0;
  }
}

function isAuthValid() {
  var key = PropertiesService.getUserProperties().getProperty("ds.key");
  if (!key) return false;
  return pingMonsteraWithKey(key) === 200;
}

function setCredentials(request) {
  var key = request.key;
  if (!key || !key.trim()) return { errorCode: "INVALID_CREDENTIALS" };
  var code = pingMonsteraWithKey(key);
  if (code === 200) {
    PropertiesService.getUserProperties().setProperty("ds.key", key.trim());
    return { errorCode: "NONE" };
  }
  return { errorCode: "INVALID_CREDENTIALS" };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getConfig(request) {
  var config = cc.getConfig();

  // --- Account selection (multi-select) ---
  var accountSelect = config
    .newSelectMultiple()
    .setId("accounts")
    .setName("Accounts")
    .setHelpText("Leave empty to include all workspace accounts. Select specific ones to narrow scope.")
    .setAllowOverride(true);

  // Fetch and populate account options from API (fails gracefully if endpoint unavailable)
  var accountOptions = getAccountOptions();
  if (accountOptions.length > 0) {
    accountOptions.forEach(function(account) {
      accountSelect.addOption(
        config.newOptionBuilder().setLabel(account.name).setValue(account.id)
      );
    });
  }

  // --- Report aggregation level ---
  config
    .newSelectSingle()
    .setId("reportLevel")
    .setName("Report Level")
    .setHelpText("Choose the granularity of your report.")
    .setAllowOverride(true)
    .addOption(config.newOptionBuilder().setLabel("Ad Set Level").setValue("adset"))
    .addOption(config.newOptionBuilder().setLabel("Campaign Level").setValue("campaign"))
    .addOption(config.newOptionBuilder().setLabel("Account Level").setValue("account"));

  // --- Platform filter ---
  config
    .newSelectSingle()
    .setId("platform")
    .setName("Platform")
    .setHelpText("Filter by ad platform. Select 'All' to include every platform.")
    .setAllowOverride(true)
    .addOption(config.newOptionBuilder().setLabel("All").setValue("all"))
    .addOption(config.newOptionBuilder().setLabel("Meta Ads").setValue("meta_ads"))
    .addOption(config.newOptionBuilder().setLabel("Google Ads").setValue("google_ads"))
    .addOption(config.newOptionBuilder().setLabel("TikTok").setValue("tiktok_business"));

  // --- Cache duration control ---
  config
    .newSelectSingle()
    .setId("cacheTtl")
    .setName("Data Freshness")
    .setHelpText("How long to cache results. Longer = faster loads, shorter = fresher data.")
    .setAllowOverride(true)
    .addOption(config.newOptionBuilder().setLabel("1 minute (freshest)").setValue("60"))
    .addOption(config.newOptionBuilder().setLabel("5 minutes").setValue("300"))
    .addOption(config.newOptionBuilder().setLabel("10 minutes (recommended)").setValue("600"))
    .addOption(config.newOptionBuilder().setLabel("30 minutes (faster)").setValue("1800"))
    .addOption(config.newOptionBuilder().setLabel("1 hour (fastest)").setValue("3600"));

  config.setDateRangeRequired(true);

  return config.build();
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function getFields() {
  var fields = cc.getFields();
  var types = cc.FieldType;
  var agg = cc.AggregationType;

  // --- Dimensions ---
  fields
    .newDimension()
    .setId("date")
    .setName("Date")
    .setDescription("The date the metrics were recorded (YYYYMMDD).")
    .setType(types.YEAR_MONTH_DAY)
    .setIsDefault(true);

  fields
    .newDimension()
    .setId("platform")
    .setName("Platform")
    .setDescription("Ad platform: meta_ads, google_ads, or tiktok_business.")
    .setType(types.TEXT);

  fields
    .newDimension()
    .setId("accountId")
    .setName("Account ID")
    .setDescription("Unique identifier for the ad account.")
    .setType(types.TEXT);

  fields
    .newDimension()
    .setId("accountName")
    .setName("Account Name")
    .setDescription("Display name of the ad account.")
    .setType(types.TEXT);

  fields
    .newDimension()
    .setId("campaignId")
    .setName("Campaign ID")
    .setDescription("Unique identifier for the campaign.")
    .setType(types.TEXT);

  fields
    .newDimension()
    .setId("campaignName")
    .setName("Campaign Name")
    .setDescription("Display name of the campaign.")
    .setType(types.TEXT);

  fields
    .newDimension()
    .setId("adsetId")
    .setName("Ad Set ID")
    .setDescription("Unique identifier for the ad set / ad group.")
    .setType(types.TEXT);

  fields
    .newDimension()
    .setId("adsetName")
    .setName("Ad Set Name")
    .setDescription("Display name of the ad set / ad group.")
    .setType(types.TEXT);

  fields
    .newDimension()
    .setId("currency")
    .setName("Currency")
    .setDescription("Currency code for the ad account (e.g. USD, VND).")
    .setType(types.TEXT);

  // --- Raw metrics (safely summable across any grouping) ---
  fields
    .newMetric()
    .setId("spend")
    .setName("Spend")
    .setDescription("Total amount spent on ads in the account currency.")
    .setType(types.NUMBER)
    .setAggregation(agg.SUM)
    .setIsDefault(true);

  fields
    .newMetric()
    .setId("impressions")
    .setName("Impressions")
    .setDescription("Total number of times your ads were shown.")
    .setType(types.NUMBER)
    .setAggregation(agg.SUM);

  fields
    .newMetric()
    .setId("clicks")
    .setName("Clicks")
    .setDescription("Total number of clicks on your ads.")
    .setType(types.NUMBER)
    .setAggregation(agg.SUM);

  fields
    .newMetric()
    .setId("conversions")
    .setName("Conversions")
    .setDescription("Total number of conversion events attributed to your ads.")
    .setType(types.NUMBER)
    .setAggregation(agg.SUM);

  fields
    .newMetric()
    .setId("revenue")
    .setName("Revenue")
    .setDescription("Total conversion value / revenue attributed to your ads in the account currency.")
    .setType(types.NUMBER)
    .setAggregation(agg.SUM);

  fields
    .newMetric()
    .setId("reach")
    .setName("Reach")
    .setDescription(
      "Number of unique people who saw your ads (per row). " +
      "Do not sum reach across date ranges — the same person may appear on multiple days."
    )
    .setType(types.NUMBER)
    .setAggregation(agg.SUM);

  // NOTE: CPC, CTR, CPM, and ROAS are intentionally excluded.
  // Pre-computing ratios per row then re-aggregating produces wrong totals.
  // Add these as Calculated Fields in your Looker Studio report:
  //   CPC  = Spend / Clicks
  //   CTR  = Clicks / Impressions
  //   CPM  = (Spend / Impressions) * 1000
  //   ROAS = Revenue / Spend

  return fields;
}

function getSchema(request) {
  return { schema: getFields().build() };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch accounts from API for config dropdown.
 * Requires GET /api/looker-studio/accounts → { accounts: [{ accountId, accountName }] }
 * Returns [] gracefully if the endpoint is unavailable — the connector still works,
 * users just won't see a pre-populated account list (all accounts are returned by default).
 */
function getAccountOptions() {
  var apiKey = PropertiesService.getUserProperties().getProperty("ds.key");
  if (!apiKey) return [];

  var response;
  try {
    response = UrlFetchApp.fetch(APP_URL + "/api/looker-studio/accounts", {
      headers: { Authorization: "Bearer " + apiKey },
      muteHttpExceptions: true,
    });
  } catch (e) {
    return []; // Network error — carry on without account pre-population
  }

  if (response.getResponseCode() !== 200) {
    return []; // Endpoint not implemented or API error — carry on
  }

  try {
    var parsed = JSON.parse(response.getContentText());
    if (parsed.accounts && Array.isArray(parsed.accounts)) {
      return parsed.accounts.map(function(acc) {
        return { id: String(acc.accountId), name: String(acc.accountName) };
      });
    }
  } catch (e) {
    return [];
  }

  return [];
}

/** Get the user-selected cache TTL, or default. */
function getCacheTtl(request) {
  var userTtl = request && request.configParams && request.configParams.cacheTtl
    ? parseInt(request.configParams.cacheTtl, 10)
    : 0;
  return userTtl > 0 ? userTtl : DEFAULT_CACHE_TTL_SECONDS;
}

/**
 * Fetch with exponential backoff retry for 5xx / timeout errors.
 * Returns full response object (not just body).
 */
function fetchWithRetry(url, options, retryCount) {
  retryCount = retryCount || 0;
  
  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    // Network timeout or other fetch exception
    if (retryCount < FETCH_RETRY_COUNT && (e.message.indexOf("timeout") !== -1 || e.message.indexOf("error") !== -1)) {
      Utilities.sleep(FETCH_RETRY_DELAY_MS * Math.pow(2, retryCount));
      return fetchWithRetry(url, options, retryCount + 1);
    }
    throw e;
  }

  var statusCode = response.getResponseCode();
  
  // Retry on 5xx errors or connection resets
  if ((statusCode >= 500 || statusCode === 0) && retryCount < FETCH_RETRY_COUNT) {
    Utilities.sleep(FETCH_RETRY_DELAY_MS * Math.pow(2, retryCount));
    return fetchWithRetry(url, options, retryCount + 1);
  }

  return response;
}

/** Date validation improvements: check year/month/day ranges. */
function normalizeDate(dateStr) {
  if (!dateStr) return "";
  var normalized = String(dateStr).replace(/-/g, "");
  if (!/^\d{8}$/.test(normalized)) return "";
  
  var year = parseInt(normalized.substring(0, 4), 10);
  var month = parseInt(normalized.substring(4, 6), 10);
  var day = parseInt(normalized.substring(6, 8), 10);
  
  // Basic sanity checks
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return "";
  }
  
  return normalized;
}

function safeString(val) {
  return val != null ? String(val) : "";
}

function safeNumber(val) {
  var n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function userMessageForHttpStatus(statusCode, responseBody) {
  if (statusCode === 401) {
    return "Your API key was rejected. Create or copy a workspace API key from Monstera Settings, reset connector credentials, and try again.";
  }
  if (statusCode === 400) {
    try {
      var o = JSON.parse(responseBody);
      if (o && o.error) return o.error;
    } catch (ignore) {}
    return "The request was invalid. Check the report date range and try again.";
  }
  return "Could not reach Monstera Cloud. Please try again later.";
}

/** Build a cache key from request parameters. */
function buildCacheKey(startDate, endDate, platform, accounts, reportLevel) {
  var accountStr = (accounts && Array.isArray(accounts) && accounts.length > 0)
    ? accounts.sort().join(",")
    : "all";
  var levelStr = reportLevel || "adset";
  return "mc_v3_" + startDate + "_" + endDate + "_" + (platform || "all") + "_" + accountStr + "_" + levelStr;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function getData(request) {
  if (!request.dateRange || !request.dateRange.startDate || !request.dateRange.endDate) {
    cc.newUserError()
      .setDebugText("getData called without dateRange")
      .setText("Choose a date range for this report, then refresh.")
      .throwException();
  }

  var requestedFields = getFields().forIds(
    request.fields.map(function (field) { return field.name; })
  );

  var apiKey = PropertiesService.getUserProperties().getProperty("ds.key");
  if (!apiKey) {
    cc.newUserError()
      .setDebugText("No stored API key for getData")
      .setText("Authorize this connector with your Monstera workspace API key.")
      .throwException();
  }

  // --- Extract config parameters ---
  var platform =
    request.configParams && request.configParams.platform !== "all"
      ? request.configParams.platform
      : null;

  var reportLevel = request.configParams && request.configParams.reportLevel
    ? request.configParams.reportLevel
    : "adset";

  var accountIds = (request.configParams && request.configParams.accounts)
    ? (Array.isArray(request.configParams.accounts) ? request.configParams.accounts : [request.configParams.accounts])
    : [];

  var cacheTtl = getCacheTtl(request);

  // --- Build API parameters ---
  var params = [
    "startDate=" + encodeURIComponent(request.dateRange.startDate),
    "endDate=" + encodeURIComponent(request.dateRange.endDate),
    "reportLevel=" + encodeURIComponent(reportLevel),
    "maxRows=" + MAX_ROWS_PER_REQUEST,
  ];
  if (platform) params.push("platform=" + encodeURIComponent(platform));
  if (accountIds.length > 0) {
    accountIds.forEach(function(id) {
      params.push("accountId=" + encodeURIComponent(id));
    });
  }

  // --- Cache lookup ---
  var cache = CacheService.getUserCache();
  var cacheKey = buildCacheKey(
    request.dateRange.startDate,
    request.dateRange.endDate,
    platform,
    accountIds,
    reportLevel
  );
  var parsedResponse = null;

  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      parsedResponse = JSON.parse(cached);
    } catch (e) {
      parsedResponse = null; // stale / corrupt — fall through to fresh fetch
    }
  }

  // --- Fresh fetch if not cached ---
  if (!parsedResponse) {
    var url = APP_URL + "/api/looker-studio?" + params.join("&");
    var response;
    var fetchError = null;
    try {
      response = fetchWithRetry(url, {
        headers: { Authorization: "Bearer " + apiKey },
        muteHttpExceptions: true,
        timeout: 30000,
      });
    } catch (e) {
      fetchError = e;
    }
    if (fetchError) {
      cc.newUserError()
        .setDebugText("Network error after retries: " + fetchError.message)
        .setText("Could not reach Monstera Cloud after multiple attempts. Check your network and try again.")
        .throwException();
    }

    var statusCode = response.getResponseCode();
    var body = response.getContentText();

    if (statusCode !== 200) {
      cc.newUserError()
        .setDebugText("API returned status " + statusCode + ": " + body)
        .setText(userMessageForHttpStatus(statusCode, body))
        .throwException();
    }

    var parseError = null;
    try {
      parsedResponse = JSON.parse(body);
    } catch (e) {
      parseError = e;
    }
    if (parseError) {
      cc.newUserError()
        .setDebugText("Failed to parse API response: " + parseError.message)
        .setText("Monstera Cloud returned an unexpected response format.")
        .throwException();
    }

    // Store in cache with user-selected TTL (silent fail if response exceeds 100 KB limit)
    try {
      cache.put(cacheKey, body, cacheTtl);
    } catch (e) {
      // Response too large to cache — continue without caching
    }
  }

  if (!parsedResponse.data || !Array.isArray(parsedResponse.data)) {
    cc.newUserError()
      .setDebugText("No data array in API response: " + JSON.stringify(parsedResponse))
      .setText("No data was returned from Monstera Cloud for the selected date range.")
      .throwException();
  }

  // Log a warning if data may be truncated — but still return what we have
  // so the report is not completely blocked. Users can narrow the date range
  // or switch to Campaign/Account level to reduce row count.
  if (parsedResponse.data.length >= MAX_ROWS_PER_REQUEST) {
    console.warn(
      "[Monstera] Response hit MAX_ROWS_PER_REQUEST (" + MAX_ROWS_PER_REQUEST + "). " +
      "Data may be truncated. Narrow the date range or use Campaign/Account level."
    );
  }

  var rows = parsedResponse.data.map(function (item) {
    var row = [];
    requestedFields.asArray().forEach(function (field) {
      var fieldId = field.getId();
      var value = "";
      
      switch (fieldId) {
        case "date":        value = normalizeDate(item.date);      break;
        case "platform":    value = safeString(item.platform);     break;
        case "accountId":   value = safeString(item.accountId);    break;
        case "accountName": value = safeString(item.accountName);  break;
        case "campaignId":  value = safeString(item.campaignId);   break;
        case "campaignName":value = safeString(item.campaignName); break;
        case "adsetId":     value = safeString(item.adsetId);      break;
        case "adsetName":   value = safeString(item.adsetName);    break;
        case "currency":    value = safeString(item.currency);     break;
        case "impressions": value = safeNumber(item.impressions);  break;
        case "clicks":      value = safeNumber(item.clicks);       break;
        case "spend":       value = safeNumber(item.spend);        break;
        case "reach":       value = safeNumber(item.reach);        break;
        case "conversions": value = safeNumber(item.conversions);  break;
        case "revenue":     value = safeNumber(item.revenue);      break;
        default:            value = "";
      }
      
      row.push(value);
    });
    return { values: row };
  });

  return {
    schema: requestedFields.build(),
    rows: rows,
  };
}

// ---------------------------------------------------------------------------

function isAdminUser() {
  return false;
}
