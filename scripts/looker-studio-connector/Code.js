/**
 * Looker Studio Community Connector for Monstera Cloud
 */

var cc = DataStudioApp.createCommunityConnector();
var APP_URL = "https://monsteracloud.com";

function getAuthType() {
  var AuthTypes = cc.AuthType;
  return cc
    .newAuthTypeResponse()
    .setAuthType(AuthTypes.KEY)
    .setHelpUrl(APP_URL + "/destinations")
    .build();
}

function resetAuth() {
  var userProperties = PropertiesService.getUserProperties();
  userProperties.deleteProperty("ds.key");
}

function isAuthValid() {
  var userProperties = PropertiesService.getUserProperties();
  var key = userProperties.getProperty("ds.key");
  if (!key) return false;

  // FIX: Actually validate token against API instead of just checking non-empty
  try {
    var response = UrlFetchApp.fetch(APP_URL + "/api/looker-studio", {
      headers: { Authorization: "Bearer " + key },
      muteHttpExceptions: true
    });
    // If it's 200, authentication succeeded
    return response.getResponseCode() === 200;
  } catch (e) {
    return false;
  }
}

function setCredentials(request) {
  var key = request.key;

  // FIX: Actually validate the token before storing it
  if (!key || key.trim() === "") {
    return { errorCode: "INVALID_CREDENTIALS" };
  }

  try {
    var response = UrlFetchApp.fetch(APP_URL + "/api/looker-studio", {
      headers: { Authorization: "Bearer " + key },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      var userProperties = PropertiesService.getUserProperties();
      userProperties.setProperty("ds.key", key);
      return { errorCode: "NONE" };
    } else {
      return { errorCode: "INVALID_CREDENTIALS" };
    }
  } catch (e) {
    return { errorCode: "INVALID_CREDENTIALS" };
  }
}

function getConfig(request) {
  var config = cc.getConfig();

  // Added: Platform filter so users can scope data before loading
  config
    .newSelectSingle()
    .setId("platform")
    .setName("Platform")
    .setHelpText("Filter by ad platform. Select 'All' to include every platform.")
    .setAllowOverride(true)
    .addOption(config.newOptionBuilder().setLabel("All").setValue("all"))
    .addOption(config.newOptionBuilder().setLabel("Meta").setValue("meta_ads"))
    .addOption(config.newOptionBuilder().setLabel("Google Ads").setValue("google_ads"))
    .addOption(config.newOptionBuilder().setLabel("TikTok").setValue("tiktok_business"));

  return config.build();
}

function getFields() {
  var fields = cc.getFields();
  var types = cc.FieldType;
  var aggregations = cc.AggregationType;

  // Dimensions
  fields.newDimension().setId("date").setName("Date").setType(types.YEAR_MONTH_DAY);
  fields.newDimension().setId("platform").setName("Platform").setType(types.TEXT);
  fields.newDimension().setId("accountId").setName("Account ID").setType(types.TEXT);
  fields.newDimension().setId("accountName").setName("Account Name").setType(types.TEXT);
  fields.newDimension().setId("campaignId").setName("Campaign ID").setType(types.TEXT);
  fields.newDimension().setId("campaignName").setName("Campaign Name").setType(types.TEXT);
  fields.newDimension().setId("adsetId").setName("Adset ID").setType(types.TEXT);
  fields.newDimension().setId("adsetName").setName("Adset Name").setType(types.TEXT);
  fields.newDimension().setId("currency").setName("Currency").setType(types.TEXT);

  // Metrics — FIX: Add explicit SUM aggregation so Looker Studio blending works correctly
  fields.newMetric().setId("impressions").setName("Impressions").setType(types.NUMBER).setAggregation(aggregations.SUM);
  fields.newMetric().setId("clicks").setName("Clicks").setType(types.NUMBER).setAggregation(aggregations.SUM);
  fields.newMetric().setId("spend").setName("Spend").setType(types.NUMBER).setAggregation(aggregations.SUM);
  fields.newMetric().setId("reach").setName("Reach").setType(types.NUMBER).setAggregation(aggregations.SUM);
  fields.newMetric().setId("conversions").setName("Conversions").setType(types.NUMBER).setAggregation(aggregations.SUM);
  fields.newMetric().setId("revenue").setName("Revenue").setType(types.NUMBER).setAggregation(aggregations.SUM);

  // FIX: Derived/ratio metrics should use AUTO aggregation — Looker Studio recalculates these
  fields.newMetric().setId("cpc").setName("CPC").setType(types.NUMBER).setAggregation(aggregations.AUTO);
  fields.newMetric().setId("ctr").setName("CTR").setType(types.NUMBER).setAggregation(aggregations.AUTO);
  fields.newMetric().setId("cpm").setName("CPM").setType(types.NUMBER).setAggregation(aggregations.AUTO);
  fields.newMetric().setId("roas").setName("ROAS").setType(types.NUMBER).setAggregation(aggregations.AUTO);

  return fields;
}

function getSchema(request) {
  return { schema: getFields().build() };
}

// FIX: Helper to normalize date → YYYYMMDD as required by Looker Studio YEAR_MONTH_DAY type
function normalizeDate(dateStr) {
  if (!dateStr) return "";
  // If already YYYYMMDD (no dashes), return as-is
  if (/^\d{8}$/.test(dateStr)) return dateStr;
  // Strip dashes from YYYY-MM-DD
  return dateStr.replace(/-/g, "");
}

// FIX: Helper to safely coerce values — nulls crash Looker Studio row parsing
function safeString(val) {
  return val != null ? String(val) : "";
}

function safeNumber(val) {
  var n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function getData(request) {
  var requestedFields = getFields().forIds(
    request.fields.map(function(field) {
      return field.name;
    })
  );

  var userProperties = PropertiesService.getUserProperties();
  var apiKey = userProperties.getProperty("ds.key");

  var url = APP_URL + "/api/looker-studio";
  var params = [];

  if (request.dateRange) {
    params.push("startDate=" + request.dateRange.startDate);
    params.push("endDate=" + request.dateRange.endDate);
  }

  // Pass platform filter from config if user selected one
  if (request.configParams && request.configParams.platform && request.configParams.platform !== "all") {
    params.push("platform=" + request.configParams.platform);
  }

  if (params.length > 0) {
    url += "?" + params.join("&");
  }

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + apiKey },
      muteHttpExceptions: true
    });
  } catch (e) {
    // FIX: Throw outside try so throwException() isn't silently swallowed
    cc.newUserError()
      .setDebugText("Network error fetching from Monstera Cloud: " + e.message)
      .setText("Could not reach Monstera Cloud. Please check your network or try again.")
      .throwException();
  }

  var statusCode = response.getResponseCode();
  if (statusCode !== 200) {
    cc.newUserError()
      .setDebugText("API returned status " + statusCode + ": " + response.getContentText())
      .setText("There was an error communicating with Monstera Cloud. Please check your credentials.")
      .throwException();
  }

  var parsedResponse;
  try {
    parsedResponse = JSON.parse(response.getContentText());
  } catch (e) {
    cc.newUserError()
      .setDebugText("Failed to parse API response: " + e.message)
      .setText("Monstera Cloud returned an unexpected response format.")
      .throwException();
  }

  if (!parsedResponse.data || !Array.isArray(parsedResponse.data)) {
    cc.newUserError()
      .setDebugText("No data array in API response: " + JSON.stringify(parsedResponse))
      .setText("No data was returned from Monstera Cloud.")
      .throwException();
  }

  var rows = parsedResponse.data.map(function(item) {
    var row = [];
    requestedFields.asArray().forEach(function(field) {
      switch (field.getId()) {
        case "date":        row.push(normalizeDate(item.date)); break;
        case "platform":    row.push(safeString(item.platform)); break;
        case "accountId":   row.push(safeString(item.accountId)); break;
        case "accountName": row.push(safeString(item.accountName)); break;
        case "campaignId":  row.push(safeString(item.campaignId)); break;
        case "campaignName":row.push(safeString(item.campaignName)); break;
        case "adsetId":     row.push(safeString(item.adsetId)); break;
        case "adsetName":   row.push(safeString(item.adsetName)); break;
        case "currency":    row.push(safeString(item.currency)); break;
        case "impressions": row.push(safeNumber(item.impressions)); break;
        case "clicks":      row.push(safeNumber(item.clicks)); break;
        case "spend":       row.push(safeNumber(item.spend)); break;
        case "reach":       row.push(safeNumber(item.reach)); break;
        case "cpc":         row.push(safeNumber(item.cpc)); break;
        case "ctr":         row.push(safeNumber(item.ctr)); break;
        case "cpm":         row.push(safeNumber(item.cpm)); break;
        case "conversions": row.push(safeNumber(item.conversions)); break;
        case "revenue":     row.push(safeNumber(item.revenue)); break;
        case "roas":        row.push(safeNumber(item.roas)); break;
        default:            row.push("");
      }
    });
    return { values: row };
  });

  return {
    schema: requestedFields.build(),
    rows: rows
  };
}

// Added: Enables stack traces in Looker Studio debug panel during development
function isAdminUser() {
  return false; // Set to true temporarily while debugging, revert before publishing
}
