// ============================================================================
// IDL — h173k_lottery (Anchor 0.29)
//
// WAŻNE: kolejność kont MUSI dokładnie odpowiadać strukturom #[derive(Accounts)]
// w programie (lib.rs). Nazwy pól kont w JS są camelCase (konwencja Anchor),
// odpowiadają snake_case w Rust.
//
// Program implementuje commit-reveal:
//   1. commitGuess(mode, playerGuess, commitment, slotHint)  — wpłaca opłatę do vaultu
//   2. revealResult(secretSalt, slotHint)                     — wypłaca nagrodę przy trafieniu
// ============================================================================

export const LOTTERY_IDL = {
  version: '0.1.0',
  name: 'h173k_lottery',
  instructions: [
    {
      name: 'initialize',
      accounts: [
        { name: 'config', isMut: true, isSigner: false },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'h173kMint', isMut: false, isSigner: false },
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
        { name: 'rent', isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: 'commitGuess',
      accounts: [
        { name: 'config', isMut: true, isSigner: false },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'ticket', isMut: true, isSigner: false },
        { name: 'playerTokenAccount', isMut: true, isSigner: false },
        { name: 'h173kMint', isMut: false, isSigner: false },
        { name: 'player', isMut: true, isSigner: true },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
        { name: 'rent', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'mode', type: 'u8' },
        { name: 'playerGuess', type: 'u64' },
        { name: 'commitment', type: { array: ['u8', 32] } },
        { name: 'slotHint', type: 'u64' },
      ],
    },
    {
      name: 'revealResult',
      accounts: [
        { name: 'config', isMut: true, isSigner: false },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'ticket', isMut: true, isSigner: false },
        { name: 'winnerTokenAccount', isMut: true, isSigner: false },
        { name: 'h173kMint', isMut: false, isSigner: false },
        { name: 'slotHashes', isMut: false, isSigner: false },
        { name: 'player', isMut: false, isSigner: true },
        { name: 'tokenProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'secretSalt', type: { array: ['u8', 32] } },
        { name: 'slotHint', type: 'u64' },
      ],
    },
  ],
  accounts: [
    {
      name: 'lotteryConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'publicKey' },
          { name: 'h173kMint', type: 'publicKey' },
          { name: 'vault', type: 'publicKey' },
          { name: 'totalTickets', type: 'u64' },
          { name: 'totalPrizesPaid', type: 'u64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'playerTicket',
      type: {
        kind: 'struct',
        fields: [
          { name: 'player', type: 'publicKey' },
          { name: 'mode', type: 'u8' },
          { name: 'playerGuess', type: 'u64' },
          { name: 'commitment', type: { array: ['u8', 32] } },
          { name: 'commitSlot', type: 'u64' },
          { name: 'slotHint', type: 'u64' },
          { name: 'isRevealed', type: 'bool' },
          { name: 'winningNumber', type: 'u64' },
          { name: 'won', type: 'bool' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
  events: [
    {
      name: 'PrizePaid',
      fields: [
        { name: 'winner', type: 'publicKey', index: false },
        { name: 'prize', type: 'u64', index: false },
      ],
    },
  ],
  errors: [
    { code: 6000, name: 'InvalidMode', msg: 'Nieprawidłowy tryb. Wybierz 1, 2 lub 3.' },
    { code: 6001, name: 'GuessOutOfRange', msg: 'Zgadywana liczba jest poza zakresem.' },
    { code: 6002, name: 'InvalidSlotHint', msg: 'slot_hint jest zbyt stary lub wyprzedza aktualny slot.' },
    { code: 6003, name: 'AlreadyRevealed', msg: 'Ten bilet został już odsłonięty.' },
    { code: 6004, name: 'RevealTooEarly', msg: 'Za wcześnie na reveal — poczekaj minimum 2 sloty.' },
    { code: 6005, name: 'TicketExpired', msg: 'Czas na reveal wygasł. Bilet przepada.' },
    { code: 6006, name: 'CommitmentMismatch', msg: 'Podany sekret nie zgadza się z commitmentem.' },
    { code: 6007, name: 'InvalidMint', msg: 'Nieprawidłowy adres mint tokenu — oczekiwano h173k.' },
    { code: 6008, name: 'EmptyVault', msg: 'Vault nie zawiera żadnych tokenów h173k.' },
    { code: 6009, name: 'PrizeTooSmall', msg: 'Nagroda wynosi 0 — saldo vaultu za małe.' },
    { code: 6010, name: 'Unauthorized', msg: 'Brak uprawnień — bilet należy do innego gracza.' },
    { code: 6011, name: 'SlotHashError', msg: 'Błąd parsowania danych sysvar SlotHashes.' },
    { code: 6012, name: 'SlotHashNotFound', msg: 'Hash slotu z momentu commitu jest już niedostępny.' },
  ],
}

export default LOTTERY_IDL
