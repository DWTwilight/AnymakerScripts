# Golf GTI MK8 Scripting Context

## Shared Globals(make sure gets updated first before use)

Globals declared at the top of the script, shared between functions:

- powerState
  - Integer
  - Power/lights state machine, owned by Power & Lights, read by Engine
  - 0 -> off
  - 1 -> Main Power On
  - 2 -> Engine Start (and Main Power On)

## Doors and Locks

### Databus Inputs (Out Variables)

- FL_Door_Handle.is_active
  - Boolean
  - true means the front-left door handle is opened
- FR_Door_Handle.is_active
  - Boolean
  - true means the front-right door handle is opened
- RL_Door_Handle.is_active
  - Boolean
  - true means the rear-left door handle is opened
- RR_Door_Handle.is_active
  - Boolean
  - true means the rear-right door handle is opened
- Trunk_Handle.is_active
  - Boolean
  - true means the trunk handle is opened
- Hood_Handle.is_active
  - Boolean
  - true means the hood handle is opened
- Door_Lock.is_pressed
  - Boolean
  - true means door lock is pressed

### Databus Outputs (In Variables)

- ASM_FL_Door_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open
- ASM_FR_Door_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open
- ASM_RL_Door_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open
- ASM_RR_Door_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open
- ASM_Trunk_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open
- ASM_Hood_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open

### Logic

Latch is open if handle is active and not locked

## Power & Lights

### Databus Inputs (Out Variables)

- Btn_Start_Stop.is_pressed
  - Boolean
  - whther Start/Stop button is pressed
- Steering_Wheel.left_pedal
  - Fractional
  - Break input, 0(no break) -> 1(full break)

### Databus Outputs (In Variables)

- Btn_Start_Stop.is_illuminated
  - Boolean
  - backlight on/off
- Dial_RPM.is_illuminated
  - Boolean
  - backlight on/off
- Dial_Speed.is_illuminated
  - Boolean
  - backlight on/off
- Display_Gear.is_illuminated
  - Boolean
  - backlight on/off
- ASM_Power_Main.input
  - Fractional
  - Main Power Relay(1 -> on)
- ASM_Power_Engine.input
  - Fractional
  - Engine Power Relay(1 -> on)

### Logic

This part owns the global state var `powerState`, declared at the top of the
script so it can be shared with the Engine logic:

```txt
powerState

0 -> off
1 -> Main Power On, turn on ASM_Power_Main
2 -> Engine Start (and Main Power On), trun on ASM_Power_Main & ASM_Power_Engine
```

- If Start/Stop Button is pressed
  - if current state is 0
    - If break input > 0.5, 0 -> 2
    - If no break (<= 0.5), 0 -> 1
  - if current state is 1
    - If break input > 0.5, 1 -> 2
    - If no break (<= 0.5), 1 -> 0
  - if current state is 2, 2 -> 0

## Transmission

### Databus Inputs (Out Variables)

- Engine.rps
  - Fractional
  - the engine starts at 6 rps (360 RPM)
- Gear_Stick.throttle
  - Integer
  - Current Gear Selection: 0 -> neutral, 1 -> reverse, 2 -> drive, 3 -> manual mode
- Paddle_Shift.throttle
  - Fractional
  - Paddle shift for manual mode. -1(down) or 1(up).
- Gearbox.current_gear
  - Integer
  - Gearbox's current gear: 0 -> neutral, -1 -> reverse, 1/2/3 -> forward gears
- Gearbox.target_gear
  - Integer
  - Gearbox's target gear. If not same as Gearbox.current_gear, the gearbox is shifting
- Gearbox.clutch_factor
  - Fractional
  - Gearbox's clutch_factor(0-1, 1 means fully engaded). If not 1, the gearbox is shifting. If the gearbox is in neutral(and not shifting), the value is 1 but the clutch is disconnected.

### Databus Outputs (In Variables)

- ASM_Gearbox.input
  - Fractional
  - above 0.75 shifts up, below -0.75 shifts down. (pulse input, constant value only shifts once)
- ASM_Reducer_A.input
  - Fractional
  - Reducer A clutch. 0 -> engaded, 1 -> disengaded
- ASM_Reducer_B.input
  - Fractional
  - Reducer B clutch. 0 -> engaded, 1 -> disengaded
- Display_Gear.display_value
  - Fractional
  - neutral -> 0, drive -> 1-6, reverse -> 9

### Logic

#### Overall design

- This is a 3x2 6-speed auto gearbox with manual mode, with 3 drive gears and 2 reducer (A, B, only one is engaded at anytime)
- gear mapping(gearbox & reducer):
  - -1: -1A
  - 0: 0A/0B
  - 1: 1A
  - 2: 2A
  - 3: 3A
  - 4: 1B
  - 5: 2B
  - 6: 3B
- Gear_Stick
  - 0 -> neutral, 1 -> reverse, 2 -> drive, 3 -> manual mode
  - drive & manual mode shifts range: 1-6
- Paddle_Shift.throttle
  - only used in manual mode
  - value treats as pulse, meaning constant value won't shift consequtively
- ASM_Gearbox.input
  - value treats as pulse, so if gear jump is needed (3 -> 1, 3 -> 0), the value needs to blink, and watch Gearbox.target_gear as target
- Anti-stall
  - define constant: `ANTI_STALL_RPS = 9`
  - if engine rps is below `ANTI_STALL_RPS`, force to neutral (by only directly changing gearbox -> 0, no need to change reducer)
  - this is a fake neutral, internal state should still be the original gear (1-6)
  - recovers if break is lifted (< 0.2? define a constant for this)

#### Impl

- Gear display: `Display_Gear.display_value` = `targetGear` (0 neutral, 1-6
  forward), or `9` when `targetGear == -1` (reverse)

## Engine

### Databus Inputs (Out Variables)

- Engine.rps
  - Fractional
  - the engine starts at 6 rps (360 RPM)
- Steering_Wheel.right_pedal
  - Fractional
  - Throttle input, 0(no Throttle) -> 1(full Throttle)

### Databus Outputs (In Variables)

- ASM_Power_Starter.input
  - Fractional
  - Engine Starter Power Relay(1 -> on)
- ASM_Throttle.input
  - Fractional
  - Actual Engine Throttle Input, 0(no Throttle) -> 1(full Throttle)
- Dial_RPM.display_value
  - Fractional
  - -1 - 1, RPS 0 -> -1, RPS 150 -> 1

### Logic

Global state:

```txt
powerState         # declared at top of script, owned by Power & Lights

IDLE_RPS = 13.5
STARTER_CUTOFF_RPS = 6.5
MIN_IDLE_THROTTLE = 0.05
```

- If `powerState` is not 2:
  - set `ASM_Power_Starter.input` -> 0.0
  - set `ASM_Throttle.input` -> 0.0
- else `powerState` is 2:
  - Starter Logic:
    - set `ASM_Power_Starter.input` -> 1.0 if `Engine.rps < STARTER_CUTOFF_RPS`, else 0.0
    - no latch needed: once RPS reaches 6.5 the starter cuts, and the throttle below stays at 1.0 until RPS > 8.5, so the engine keeps accelerating instead of chattering
  - Throttle Logic (always evaluated while `powerState` is 2):
    1. calculate minimal throttle to keep idle (anti-stall), constant global `IDLE_RPS` (13.5)
       - `minimalThrottle = (IDLE_RPS - Engine.rps) * 0.2`
       - clamp `minimalThrottle` to `[MIN_IDLE_THROTTLE, 1.0]`
       - this is 1.0 for all `Engine.rps <= 8.5`, so cranking naturally gets full throttle
    2. apply pedal input (skipped while `antiStall` is active):
       - `engineThrottle = minimalThrottle + (1.0 - minimalThrottle) * pedalInput`
       - clamp `engineThrottle` to `[MIN_IDLE_THROTTLE, 1.0]`
    3. set `ASM_Throttle.input` -> `engineThrottle`
- RPM dial: `Dial_RPM.display_value = dial_map(Engine.rps, 0, DIAL_RPM_MAX)`

`dial_map(input, min, max)` maps `[min, max]` to `[-1, 1]` and clamps the result
to `[-1, 1]`.

## Steering

### Databus Inputs (Out Variables)

- Steering_Wheel.steering
  - Fractional
  - Throttle input, -1(full left) -> 1(full right)

### Databus Outputs (In Variables)

- ASM_Steering_Left.input
  - Fractional
  - steering left input (-1 - 1), 1 is turing left
- ASM_Steering_Right.input
  - Fractional
  - steering right input (-1 - 1), 1 is turning right

### Logic

Calculate accurate steering based on Ackermann steering geometry.

Constants:
- WHEEL_BASE: 2.72m
- TRACK_WIDTH: 1.52m
- MAX_VIRTUAL_STEER_ANG: 0.5236(rad, 30 degrees)
- STEER_DEAD_ZONE: 0.001 (|steering| below this is treated as straight)
- MAX_INNER_STEER_ANGLE: computed at full lock as
  `atan(WHEEL_BASE / (WHEEL_BASE / tan(MAX_VIRTUAL_STEER_ANG) - TRACK_WIDTH / 2))`,
  ≈ 0.6025 rad (34.5°); used to normalize both wheel angles so the inner wheel
  reaches 1.0 at full lock

Sign convention (physical left/right wheels): positive turns toward that wheel's
side. A right turn gives `Right = +inner`, `Left = -outer`; a left turn gives
`Left = +inner`, `Right = -outer`; straight gives both 0.

## Break

### Databus Inputs (Out Variables)

- Steering_Wheel.left_pedal
  - Fractional
  - Break input, 0(no break) -> 1(full break)
- Wheel_FL.rps
  - Fractional
  - FL Wheel rps
- Wheel_FR.rps
  - Fractional
  - FR Wheel rps
- Wheel_RL.rps
  - Fractional
  - RL Wheel rps
- Wheel_RR.rps
  - Fractional
  - RR Wheel rps
- Btn_Handbrake.is_pressed
  - Boolean
  - digital handbrake button
- Btn_Autohold.is_pressed
  - Boolean
  - autohold button
- Btn_ABS.is_pressed
  - Boolean
  - ABS button

### Databus Outputs (In Variables)

- ASM_Brake_FL.input
  - Fractional
  - FL brake force, 0(no brake) -> 1(full brake)
- ASM_Brake_FR.input
  - Fractional
  - FR brake force, 0(no brake) -> 1(full brake)
- ASM_Brake_RL.input
  - Fractional
  - RL brake force, 0(no brake) -> 1(full brake)
- ASM_Brake_RR.input
  - Fractional
  - RR brake force, 0(no brake) -> 1(full brake)
- Btn_Handbrake.is_illuminated
  - Boolean
  - digital handbrake button light switch
- Btn_Autohold.is_illuminated
  - Boolean
  - autohold button light switch
- Btn_ABS.is_illuminated
  - Boolean
  - abs button light switch
- Dial_Speed.display_value
  - Fractional
  - -1 - 1. 0 km/h -> -1, 240 km/h -> 1

### Logic

#### Constants

- `REAR_BRAKE_RATIO = 3.0 / 7.0`
  - rear pressure per unit of front pressure, from `front:rear = 7:3`
  - front is the reference (gets the full proxy pedal); rear is proportional
- `AUTOHOLD_STOP_RPS = 0.1`
  - `abs(wheel.rps)` below this counts as a stopped wheel
- `AUTOHOLD_RELEASE_THROTTLE = 0.1`
  - driver throttle above this releases autohold
- `ABS_MIN_BRAKE = 0.2`
  - ABS is only evaluated when `brakePedal > ABS_MIN_BRAKE`
- `ABS_TARGET_SPEED_RATIO = 0.8`
  - target wheel speed as a fraction of `refSpeed`; below this the wheel is
    slipping and its brake pressure is dropped to `0` for that tick
- `ABS_MIN_SPEED_RPS = 0.5`
  - ABS is disabled when `refSpeed` is at or below this

#### Global state

```txt
handbrakeActive        # latched parking-brake state
lastHandbrakePressed   # handbrake button edge detector
autoholdEnabled        # autohold mode, toggled by button
lastAutoholdPressed    # autohold button edge detector
autoholdActive         # autohold currently holding the brake
brakePedal             # effective/proxied brake pedal (0-1)
absEnabled             # ABS on/off, default on
lastABSPressed         # ABS button edge detector
```

#### Button handling

Handbrake (latching, like an electronic parking brake):

- on the rising edge of `Btn_Handbrake.is_pressed`, toggle `handbrakeActive`
- a held button does not repeat; same edge pattern as `btnStartStopPressFlag`
- allowed regardless of power, because the light is independently power-gated

Autohold mode (latching):

- only toggled when `powerState > 0`
- on the rising edge of `Btn_Autohold.is_pressed`, toggle `autoholdEnabled`
- when `powerState == 0`, force `autoholdEnabled = false` and
  `autoholdActive = false`
- always update `lastAutoholdPressed` each tick, even while powered off, so
  holding the button through a power cycle does not create a false edge later

ABS (latching, default on):

- on the rising edge of `Btn_ABS.is_pressed`, toggle `absEnabled`
- a held button does not repeat
- the state is not reset on power off; ABS comes back in whatever state it was
  left in

#### Autohold activation

Only evaluated while `autoholdEnabled` and `powerState > 0`:

1. if driver throttle `Steering_Wheel.right_pedal > AUTOHOLD_RELEASE_THROTTLE`,
   set `autoholdActive = false`
2. elseif all four wheels are stopped, set `autoholdActive = true`:
   - `abs(Wheel_FL.rps) < AUTOHOLD_STOP_RPS`
   - `abs(Wheel_FR.rps) < AUTOHOLD_STOP_RPS`
   - `abs(Wheel_RL.rps) < AUTOHOLD_STOP_RPS`
   - `abs(Wheel_RR.rps) < AUTOHOLD_STOP_RPS`
3. otherwise keep the previous `autoholdActive` state

Additional rules:

- when `autoholdEnabled` is false, force `autoholdActive = false`
- use `abs(...)`: wheel rps is signed (negative in reverse), so a raw
  `rps < 0.1` test would always be true while reversing
- read all four wheel speeds once per tick into `abs`-valued locals inside
  nested `requires`; an unavailable wheel leaves its local at `0.0`
- use the driver pedal, not `ASM_Throttle.input`; idle/anti-stall control can
  raise the actual throttle above 0.1 with no driver input
- activation does not require the brake pedal, so the car also holds after
  coasting to a stop; requiring `left_pedal > 0.05` is a possible refinement,
  but it is not part of this design

#### Brake proxy

`brakePedal` is the single value all brake pressures are derived from:

```txt
brakePedal = Steering_Wheel.left_pedal
if autoholdActive:
    brakePedal = 1.0
```

This makes autohold behave as if the driver keeps the pedal fully pressed,
while the real pedal input is ignored. It is the single proxy for "current
brake pedal access"; Power, Transmission, and Engine read it instead of
`Steering_Wheel.left_pedal`. Brake is evaluated before Transmission and Engine,
so those see the current tick; Power runs first, so it sees the previous tick.

#### ABS

Stateless four-channel bang-bang ABS: everything is recomputed every tick, with
no per-wheel latch. The fastest wheel is the speed reference; any wheel below
the target speed has its brake fully released to `0` for that tick.

Reference speed and run condition each tick:

```txt
refSpeed = max(abs(Wheel_FL.rps), abs(Wheel_FR.rps),
               abs(Wheel_RL.rps), abs(Wheel_RR.rps))

absRunning = absEnabled
             && (brakePedal > ABS_MIN_BRAKE)
             && (refSpeed > ABS_MIN_SPEED_RPS)
```

Per-wheel factor (same logic for FL, FR, RL, RR):

```txt
absTargetSpeed = ABS_TARGET_SPEED_RATIO * refSpeed

if (absRunning && (absSpeedX < absTargetSpeed)):
    absFactorX = 0.0    # fully release this wheel
else:
    absFactorX = 1.0    # normal braking
```

- this is bang-bang: full pressure or nothing, no partial ramp
- the fastest wheel has `speed = refSpeed`, which is above the target, so it
  keeps full pressure and does not brake itself loose
- there is no hysteresis, so a wheel hovering at the threshold can chatter; add
  a recover threshold if that shows up in testing

`absTriggered` is a per-tick local, not persistent:

```txt
absTriggered = (absFactorFL == 0) || (absFactorFR == 0)
            || (absFactorRL == 0) || (absFactorRR == 0)
```

#### Speed dial

`Dial_Speed.display_value = dial_map(speedKmh, 0, DIAL_SPEED_MAX)`, where

```txt
avgRps = avg(abs(Wheel_FL.rps), abs(Wheel_FR.rps),
             abs(Wheel_RL.rps), abs(Wheel_RR.rps))
speedKmh = avgRps * 2 * PI * WHEEL_RADIUS * 3.6
```

with `WHEEL_RADIUS = 0.33 m` and `DIAL_SPEED_MAX = 240 km/h`. The wheel speeds
are the shared `abs`-valued locals, so the dial updates every tick; if wheels
are unavailable it reads `0.0` (dial at minimum). Taking `abs` makes the
reading positive in reverse.

#### Brake pressures

- Front base: `brakePedal`
- Rear base: `brakePedal * REAR_BRAKE_RATIO`, or `1.0` when `handbrakeActive`
  (bypassing the ratio; front is unaffected)
- ABS: each wheel output is multiplied by its `absFactorX`
- so `FL = frontBase * absFactorFL`, `FR = frontBase * absFactorFR`,
  `RL = rearBase * absFactorRL`, `RR = rearBase * absFactorRR`
- no clamping is needed: the pedal is in `[0, 1]`, `REAR_BRAKE_RATIO < 1`, and
  each ABS factor is in `[0, 1]`

Base combinations (before ABS modulation):

- pedal only: front = pedal, rear = pedal * 3/7
- handbrake only: front = 0, rear = 1.0
- autohold only: front = 1.0, rear = 3/7
- handbrake + autohold: front = 1.0, rear = 1.0
- handbrake + pedal: front = pedal, rear = 1.0

#### Button lights

- `Btn_Handbrake.is_illuminated = handbrakeActive && powerState > 0`
- `Btn_Autohold.is_illuminated = autoholdEnabled && powerState > 0`
  - the autohold light reflects the mode being enabled, not the momentary
    `autoholdActive` hold state
- `Btn_ABS.is_illuminated = (!absEnabled) || absTriggered`
  - on when ABS is disabled or a wheel is being modulated this tick

#### Interactions / caveats

- `handbrakeActive` initializes to `true`, so the rear brakes are engaged at
  script load until the handbrake button releases them.
- ABS needs at least one wheel turning faster than the others: if all four lock
  at once the reference speed collapses and slip cannot be detected. A
  held/decaying reference is the next step if this matters.
- pure handbrake use does not trigger ABS, because ABS requires
  `brakePedal > ABS_MIN_BRAKE`
- ABS uses the shared `abs`-valued wheel-rps locals; if wheels are unavailable
  they stay `0.0`, so `absRefSpeed` is `0` and every factor is `1.0`
- if a wheel databus is missing its local stays `0.0`, which autohold treats as
  stopped; add a `wheelsAvailable` guard if missing wheels are possible
- bang-bang release has no hysteresis, so wheel pressure can chatter around the
  threshold; tune `ABS_TARGET_SPEED_RATIO` or add a recover threshold if needed

