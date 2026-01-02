# 🔒 H173K Wallet - Poprawki Bezpieczeństwa

## ⚠️ WAŻNE - Znalezione i naprawione problemy

### Problem 1: KRYTYCZNY - Hardcoded klucz szyfrujący
**Plik:** `src/crypto/auth.js` (linia 218, 265)

**Stary kod (NIEBEZPIECZNY!):**
```javascript
CryptoJS.AES.encrypt(userPassword, 'h173k_biometric_key')
```

**Problem:** Klucz `'h173k_biometric_key'` był **taki sam dla WSZYSTKICH użytkowników** i był widoczny w kodzie źródłowym. Każdy kto miał dostęp do kodu mógł odszyfrować hasła wszystkich użytkowników!

**Poprawka:** Każde urządzenie ma teraz unikalny, losowo wygenerowany klucz przechowywany lokalnie.

---

### Problem 2: Statyczny salt dla PIN
**Plik:** `src/crypto/auth.js` (linia 42)

**Stary kod:**
```javascript
CryptoJS.SHA256(pin + '_h173k_pin_salt_v1')
```

**Problem:** Ten sam salt dla wszystkich użytkowników umożliwiał ataki słownikowe i rainbow tables.

**Poprawka:** Unikalny, losowo wygenerowany salt dla każdego użytkownika + PBKDF2 z 100,000 iteracji.

---

### Problem 3: Statyczny salt dla hasła portfela
**Plik:** `src/crypto/wallet.js` (linia 126)

**Stary kod:**
```javascript
CryptoJS.SHA256(password + '_h173k_salt')
```

**Problem:** Identyczny problem jak powyżej.

**Poprawka:** Unikalny salt per portfel + PBKDF2.

---

### Problem 4: Brak key stretching
Proste SHA256 było zbyt szybkie - atakujący mógł testować miliony haseł na sekundę.

**Poprawka:** PBKDF2 z 100,000 iteracji znacząco spowalnia ataki brute-force.

---

## ✅ Wprowadzone poprawki

### auth.js
1. **Unikalny salt per użytkownik** - generowany losowo przy tworzeniu PIN-u
2. **PBKDF2 z 100,000 iteracji** - zamiast prostego SHA256
3. **Unikalny deviceKey per urządzenie** - zamiast hardcoded klucza
4. **Losowy IV per szyfrowanie** - dla lepszej ochrony

### wallet.js
1. **Unikalny salt per portfel** - generowany przy tworzeniu
2. **PBKDF2 do derywacji klucza** - bezpieczna derywacja z hasła
3. **Losowy IV dla AES** - każde szyfrowanie używa nowego IV
4. **Bezpieczne czyszczenie pamięci** - nadpisywanie secretKey zerami przy blokowaniu

---

## 📊 Porównanie bezpieczeństwa

| Aspekt | Stary kod | Nowy kod |
|--------|-----------|----------|
| Klucz szyfrujący biometryki | Hardcoded (taki sam dla wszystkich) | Losowy, unikalny per urządzenie |
| Salt dla PIN | Statyczny | Losowy, unikalny per użytkownik |
| Salt dla portfela | Statyczny | Losowy, unikalny per portfel |
| Key derivation | SHA256 (szybki) | PBKDF2 100k iteracji (wolny) |
| IV dla AES | Brak/stały | Losowy per operację |
| Czyszczenie pamięci | Brak | Nadpisywanie zerami |

---

## 🔄 Kompatybilność wsteczna

**WAŻNE:** Po aktualizacji użytkownicy będą musieli:
1. Utworzyć nowy portfel LUB
2. Zaimportować istniejący portfel używając seed phrase

Stare dane szyfrowane słabą kryptografią nie będą automatycznie migrowane ze względów bezpieczeństwa.

---

## 🚀 Dodatkowe rekomendacje na przyszłość

1. **Web Crypto API** - rozważ użycie natywnego API zamiast CryptoJS
2. **Argon2** - bardziej odporny na GPU niż PBKDF2
3. **Authenticated encryption** - AES-GCM zamiast AES-CBC
4. **CSP headers** - ochrona przed XSS
5. **Rate limiting** - na poziomie serwera

---

## 📝 Changelog

### v1.0.1 (Security Fix)
- Naprawiono krytyczną lukę z hardcoded kluczem szyfrującym
- Dodano unikalny salt per użytkownik/portfel
- Zaimplementowano PBKDF2 z 100,000 iteracji
- Dodano losowy IV dla każdej operacji szyfrowania
- Dodano bezpieczne czyszczenie pamięci
