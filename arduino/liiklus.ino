// Kreutzwaldi tänava valgusfoor — füüsiline foor (ESP8266)
//
// Loeb Google Apps Scriptist praeguse oleku ja näitab seda LED-idel.
// Üks plaat = üks autofoor (A1 või A7) + üks jalakäijate foor (J1 või J6).
// Vali allpool CAR_SIGNAL ja PERSON_SIGNAL vastavalt sellele, millist foori see plaat näitab.

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WiFiMulti.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <ArduinoJson.h>

#define carRed D0
#define carYellow D1
#define carGreen D2
#define personRed D3
#define personGreen D4

#ifndef STASSID
#define STASSID "TLU"
#define STAPSK ""
#endif

// Millist signaali see plaat näitab: "A1" või "A7", "J1" või "J6".
const char* CAR_SIGNAL = "A1";
const char* PERSON_SIGNAL = "J1";

String url = "https://script.google.com/macros/s/AKfycbwPbwky8fri2VPIsEYw0bgAAe7TtB1lyMY-N1u5RFLSS5KZdjkepiVNle3eKyESg-hP/exec";

ESP8266WiFiMulti WiFiMulti;

String carLight = "";
String personLight = "";

const unsigned long fetchInterval = 1000;
const unsigned long blinkInterval = 500;
unsigned long lastFetch = 0;

void allLedsOff();
void fetchTrafficState();
void updateTrafficLeds();

void setup() {
  pinMode(carRed, OUTPUT);
  pinMode(carYellow, OUTPUT);
  pinMode(carGreen, OUTPUT);
  pinMode(personRed, OUTPUT);
  pinMode(personGreen, OUTPUT);

  allLedsOff();

  Serial.begin(115200);
  Serial.println();
  Serial.println("Starting traffic light client");

  WiFi.mode(WIFI_STA);
  WiFiMulti.addAP(STASSID, STAPSK);

  Serial.println("Connecting to WiFi...");
}

void loop() {
  if (millis() - lastFetch >= fetchInterval) {
    lastFetch = millis();

    if (WiFiMulti.run() == WL_CONNECTED) {
      fetchTrafficState();
    } else {
      Serial.println("WiFi not connected");
    }
  }
  updateTrafficLeds();
  yield();
}

void fetchTrafficState() {
  std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
  client->setInsecure();

  HTTPClient https;
  https.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  if (!https.begin(*client, url)) {
    Serial.println("[HTTPS] Unable to connect");
    return;
  }

  int httpCode = https.GET();

  if (httpCode == HTTP_CODE_OK) {
    String payload = https.getString();

    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (!error) {
      // Uued väljad (A1/A7/J1/J6); kui Apps Script neid veel ei salvesta, kasuta vanu.
      carLight = doc[CAR_SIGNAL] | (doc["currentCarLight"] | "");
      personLight = doc[PERSON_SIGNAL] | (doc["currentPersonLight"] | "");

      Serial.printf("%s: %s, %s: %s\n", CAR_SIGNAL, carLight.c_str(), PERSON_SIGNAL, personLight.c_str());
    } else {
      Serial.print("[JSON] Parse error: ");
      Serial.println(error.c_str());
    }
  } else if (httpCode > 0) {
    Serial.printf("[HTTPS] Unexpected status code: %d\n", httpCode);
  } else {
    Serial.printf("[HTTPS] GET failed: %s\n", https.errorToString(httpCode).c_str());
  }

  https.end();
}

void updateTrafficLeds() {
  bool blinkOn = ((millis() / blinkInterval) % 2) == 0;

  // Autod: red, redyellow, yellow, green, blinkinggreen
  digitalWrite(carRed,    carLight == "red" || carLight == "redyellow");
  digitalWrite(carYellow, carLight == "yellow" || carLight == "redyellow");
  digitalWrite(carGreen,  carLight == "green" || (carLight == "blinkinggreen" && blinkOn));

  // Jalakäijad: red, green, blinkinggreen
  digitalWrite(personRed,   personLight == "red");
  digitalWrite(personGreen, personLight == "green" || (personLight == "blinkinggreen" && blinkOn));
}

void allLedsOff() {
  digitalWrite(carRed, LOW);
  digitalWrite(carYellow, LOW);
  digitalWrite(carGreen, LOW);
  digitalWrite(personRed, LOW);
  digitalWrite(personGreen, LOW);
}
