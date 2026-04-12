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
    .setHelpUrl(APP_URL + "/looker-studio")
    .build();
}

function resetAuth() {
  var userProperties = PropertiesService.getUserProperties();
  userProperties.deleteProperty("ds.key");
}

/** Lightweight key check — avoids loading campaign rows on every auth refresh. */
function pingMonsteraWithKey(key) {
  if (!key || !key.trim()) return 401;
  try {
    var response = UrlFetchApp.fetch(
      APP_URL + "/api/looker-studio?ping=1",
      {
        headers: { Authorization: "Bearer " + key.trim() },
        muteHttpExceptions: true,
      }
    );
    return response.getResponseCode();
  } catch (e) {
    return 0;
  }
}

function isAuthValid() {
  var userProperties = PropertiesService.getUserProperties();
  var key = userProperties.getProperty("ds.key");
  if (!key) return false;
  return pingMonsteraWithKey(key) === 200;
}

function setCredentials(request) {
  var key = request.key;
  if (!key || !key.trim()) {
    return { errorCode: "INVALID_CREDENTIALS" };
  }
  var code = pingMonsteraWithKey(key);
  if (code === 200) {
    PropertiesService.getUserProperties().setProperty("ds.key", key.trim());
    return { errorCode: "NONE" };
  }
  return { errorCode: "INVALID_CREDENTIALS" };
}

function getConfig(request) {
  var config = cc.getConfig();

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

  config.setDateRangeRequired(true);

  return config.build();
}

function getFields() {
  var fields = cc.getFields();
  var types = cc.FieldType;
  var aggregations = cc.AggregationType;

  fields.newDimension().setId("date").setName("Date").setType(types.YEAR_MONTH_DAY);
  fields.newDimension().setId("platform").setName("Platform").setType(types.TEXT);
  fields.newDimension().setId("accountId").setName("Account ID").setType(types.TEXT);
  fields.newDimension().setId("accountName").setName("Account Name").setType(types.TEXT);
  fields.newDimension().setId("campaignId").setName("Campaign ID").setType(types.TEXT);
  fields.newDimension().setId("campaignName").setName("Campaign Name").setType(types.TEXT);
  fields.newDimension().setId("adsetId").setName("Adset ID").setType(types.TEXT);
  fields.newDimension().setId("adsetName").setName("Adset Name").setType(types.TEXT);
  fields.newDimension().setId("currency").setName("Currency").setType(types.TEXT);

  fields.newMetric().setId("impressions").setName("Impressions").setType(types.NUMBER).setAggregation(aggregations.SUM);
  fields.newMetric().setId("clicks").setName("Clicks").setType(types.NUMBER).setAggregation(aggregations.SUM);
  fields.newMetric().setId("spend").setName("Spend").setType(types.NUMBER).setAggregation(aggregations.SUM);
  fields.newMetric().setId("reach").setName("Reach").setType(types.NUMBER).setAggregation(aggregations.SUM);
  fields.newMetric().setId("conversions").setName("Conversions").setType(types.NUMBER).setAggregation(aggregations.SUM);
  fields.newMetric().setId("revenue").setName("Revenue").setType(types.NUMBER).setAggregation(aggregations.SUM);

  fields.newMetric().setId("cpc").setName("CPC").setType(types.NUMBER).setAggregation(aggregations.AUTO);
  fields.newMetric().setId("ctr").setName("CTR").setType(types.NUMBER).setAggregation(aggregations.AUTO);
  fields.newMetric().setId("cpm").setName("CPM").setType(types.NUMBER).setAggregation(aggregations.AUTO);
  fields.newMetric().setId("roas").setName("ROAS").setType(types.NUMBER).setAggregation(aggregations.AUTO);

  return fields;
}

function getSchema(request) {
  return { schema: getFields().build() };
}

function normalizeDate(dateStr) {
  if (!dateStr) return "";
  if (/^\d{8}$/.test(dateStr)) return dateStr;
  return String(dateStr).replace(/-/g, "");
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
    return "Your API key was rejected. Create or copy a workspace API key from Monstera Settings, or reset connector credentials and try again.";
  }
  if (statusCode === 400) {
    try {
      var o = JSON.parse(responseBody);
      if (o && o.error) return o.error;
    } catch (ignore) {}
    return "The request was invalid. Check the report date range and try again.";
  }
  return "There was an error communicating with Monstera Cloud. Please try again.";
}

function getData(request) {
  if (!request.dateRange || !request.dateRange.startDate || !request.dateRange.endDate) {
    cc.newUserError()
      .setDebugText("getData called without dateRange")
      .setText("Choose a date range for this report, then refresh.")
      .throwException();
  }

  var requestedFields = getFields().forIds(
    request.fields.map(function (field) {
      return field.name;
    })
  );

  var apiKey = PropertiesService.getUserProperties().getProperty("ds.key");
  if (!apiKey) {
    cc.newUserError()
      .setDebugText("No stored API key for getData")
      .setText("Authorize this connector with your Monstera workspace API key.")
      .throwException();
  }

  var params = [
    "startDate=" + encodeURIComponent(request.dateRange.startDate),
    "endDate=" + encodeURIComponent(request.dateRange.endDate),
  ];

  if (request.configParams && request.configParams.platform && request.configParams.platform !== "all") {
    params.push("platform=" + encodeURIComponent(request.configParams.platform));
  }

  var url = APP_URL + "/api/looker-studio?" + params.join("&");

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + apiKey },
      muteHttpExceptions: true,
    });
  } catch (e) {
    cc.newUserError()
      .setDebugText("Network error fetching from Monstera Cloud: " + e.message)
      .setText("Could not reach Monstera Cloud. Check your network and try again.")
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

  var parsedResponse;
  try {
    parsedResponse = JSON.parse(body);
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

  var rows = parsedResponse.data.map(function (item) {
    var row = [];
    requestedFields.asArray().forEach(function (field) {
      switch (field.getId()) {
        case "date":
          row.push(normalizeDate(item.date));
          break;
        case "platform":
          row.push(safeString(item.platform));
          break;
        case "accountId":
          row.push(safeString(item.accountId));
          break;
        case "accountName":
          row.push(safeString(item.accountName));
          break;
        case "campaignId":
          row.push(safeString(item.campaignId));
          break;
        case "campaignName":
          row.push(safeString(item.campaignName));
          break;
        case "adsetId":
          row.push(safeString(item.adsetId));
          break;
        case "adsetName":
          row.push(safeString(item.adsetName));
          break;
        case "currency":
          row.push(safeString(item.currency));
          break;
        case "impressions":
          row.push(safeNumber(item.impressions));
          break;
        case "clicks":
          row.push(safeNumber(item.clicks));
          break;
        case "spend":
          row.push(safeNumber(item.spend));
          break;
        case "reach":
          row.push(safeNumber(item.reach));
          break;
        case "cpc":
          row.push(safeNumber(item.cpc));
          break;
        case "ctr":
          row.push(safeNumber(item.ctr));
          break;
        case "cpm":
          row.push(safeNumber(item.cpm));
          break;
        case "conversions":
          row.push(safeNumber(item.conversions));
          break;
        case "revenue":
          row.push(safeNumber(item.revenue));
          break;
        case "roas":
          row.push(safeNumber(item.roas));
          break;
        default:
          row.push("");
      }
    });
    return { values: row };
  });

  return {
    schema: requestedFields.build(),
    rows: rows,
  };
}

function isAdminUser() {
  return false;
}
