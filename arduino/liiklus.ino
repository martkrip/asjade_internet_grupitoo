// Kreutzwaldi tänava valgusfoor — füüsiline foor (ESP8266)
//
// ESP on väike veebiserver samas WiFi võrgus. Leht (liiklus.html + main.js) saadab talle oleku:
//   GET http://valgusfoor-a1.local/state?A1=green&A7=green&J1=red&J6=red
// ESP võtab sealt enda signaalid (CAR_SIGNAL, PERSON_SIGNAL) ja paneb LED-id põlema.
// Kui 5 s jooksul olekut ei tule (leht kinni / võrk maas), vilgub autodele kollane.
//
// Üks plaat = üks autofoor (A1 või A7) + üks jalakäijate foor (J1 või J6).

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>

#define carRed D0
#define carYellow D1
#define carGreen D2
#define personRed D3
#define personGreen D4

// WiFi, kus on ka arvuti, millel leht lahti on (nt telefoni hotspot).
#ifndef STASSID
#define STASSID "TLU"
#define STAPSK ""
#endif

// Millist foori see plaat näitab. Teise plaadi jaoks: "A7", "J6", "valgusfoor-a7".
const char* CAR_SIGNAL = "A1";
const char* PERSON_SIGNAL = "J1";
const char* HOSTNAME = "valgusfoor-a1";   // -> http://valgusfoor-a1.local

const unsigned long TIMEOUT_MS = 5000;
const unsigned long blinkInterval = 500;

ESP8266WebServer server(80);

String carLight = "";
String personLight = "";
unsigned long lastUpdate = 0;
bool gotUpdate = false;

void handleState();
void updateTrafficLeds();
void allLedsOff();

void setup() {
  pinMode(carRed, OUTPUT);
  pinMode(carYellow, OUTPUT);
  pinMode(carGreen, OUTPUT);
  pinMode(personRed, OUTPUT);
  pinMode(personGreen, OUTPUT);
  allLedsOff();

  Serial.begin(115200);
  Serial.println();
  Serial.println("Starting traffic light server");

  WiFi.mode(WIFI_STA);
  WiFi.hostname(HOSTNAME);
  WiFi.begin(STASSID, STAPSK);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  if (MDNS.begin(HOSTNAME)) {
    MDNS.addService("http", "tcp", 80);
    Serial.printf("Name: http://%s.local\n", HOSTNAME);
  }

  server.on("/state", handleState);
  server.begin();
}

void loop() {
  server.handleClient();
  MDNS.update();
  updateTrafficLeds();
}

// GET /state?A1=green&A7=green&J1=red&J6=red
void handleState() {
  if (server.hasArg(CAR_SIGNAL)) carLight = server.arg(CAR_SIGNAL);
  if (server.hasArg(PERSON_SIGNAL)) personLight = server.arg(PERSON_SIGNAL);
  lastUpdate = millis();
  gotUpdate = true;

  Serial.printf("%s: %s, %s: %s\n", CAR_SIGNAL, carLight.c_str(), PERSON_SIGNAL, personLight.c_str());

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "OK");
}

void updateTrafficLeds() {
  bool blinkOn = ((millis() / blinkInterval) % 2) == 0;

  String car = carLight;
  String person = personLight;

  // Turvarežiim: lehelt pole ammu midagi tulnud -> autodele vilkuv kollane, jalakäijad väljas.
  if (!gotUpdate || millis() - lastUpdate > TIMEOUT_MS) {
    car = "blinkingyellow";
    person = "";
  }

  // Autod: red, redyellow, yellow, green, blinkinggreen, blinkingyellow
  digitalWrite(carRed,    car == "red" || car == "redyellow");
  digitalWrite(carYellow, car == "yellow" || car == "redyellow" || (car == "blinkingyellow" && blinkOn));
  digitalWrite(carGreen,  car == "green" || (car == "blinkinggreen" && blinkOn));

  // Jalakäijad: red, green, blinkinggreen
  digitalWrite(personRed,   person == "red");
  digitalWrite(personGreen, person == "green" || (person == "blinkinggreen" && blinkOn));
}

void allLedsOff() {
  digitalWrite(carRed, LOW);
  digitalWrite(carYellow, LOW);
  digitalWrite(carGreen, LOW);
  digitalWrite(personRed, LOW);
  digitalWrite(personGreen, LOW);
}
