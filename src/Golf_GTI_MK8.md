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

#### Drive mode (auto shift)

Automatic up/down shifting is only active in drive (`Gear_Stick.throttle == 2`)
with the engine running (`powerState == 2`). It picks an effective gear 1-6 and
writes it to `targetGear`; the existing reducer/gearbox/pulse logic then maps it
to the physical 3x2 gearbox.

**Inputs**

- `Engine.rps` - engine speed in **rps** (multiply by 60 for RPM)
- `Steering_Wheel.right_pedal` - driver throttle `theta`, 0-1
  - use the driver pedal, **not** `ASM_Throttle.input` (that is idle-blended,
    so it never reaches 0 and would break the coasting shift points)
- `Gearbox.current_gear` / `Gearbox.target_gear` - physical 0/-1/1/2/3
- `Gearbox.clutch_factor` - 1 means engaged; < 1 means shifting

**Constants**

```txt
RPM_PER_RPS        = 60.0
SHIFT_CURVE_K      = 1.5
GEAR_RATIO_STEP    = 0.72      # ratio(g+1) / ratio(g), uniform
HYSTERESIS_MAX     = 0.25      # h at theta = 0
HYSTERESIS_MIN     = 0.08      # h at theta = 1

# upshift base (theta=0) and limit (theta=1), gears 1..5
define list fractional UPSHIFT_BASE
define list fractional UPSHIFT_LIMIT
```

Per-gear upshift base and full-throttle limit (RPM):

| Gear  | Base (theta=0) | Limit (theta=1) |
| :---: | :------------: | :-------------: |
| 1->2  |      1800      |      4000       |
| 2->3  |      2000      |      4500       |
| 3->4  |      2200      |      5000       |
| 4->5  |      2400      |      5500       |
| 5->6  |      2600      |      6000       |

**Global init (runs once at load)**

```txt
var UPSHIFT_BASE append (0.0)      # dummy at index 0, unused
var UPSHIFT_BASE append (1800.0)
var UPSHIFT_BASE append (2000.0)
var UPSHIFT_BASE append (2200.0)
var UPSHIFT_BASE append (2400.0)
var UPSHIFT_BASE append (2600.0)

var UPSHIFT_LIMIT append (0.0)     # dummy at index 0, unused
var UPSHIFT_LIMIT append (4000.0)
var UPSHIFT_LIMIT append (4500.0)
var UPSHIFT_LIMIT append (5000.0)
var UPSHIFT_LIMIT append (5500.0)
var UPSHIFT_LIMIT append (6000.0)
```

The dummy at index 0 makes the lists 1-based, so gear `g` reads
`UPSHIFT_BASE[g]` and `UPSHIFT_LIMIT[g]` directly. Index 0 is never used.

**Upshift**

```txt
RPM_up(g, theta) = UPSHIFT_BASE[g]
                 + (UPSHIFT_LIMIT[g] - UPSHIFT_BASE[g])
                 * theta ^ SHIFT_CURVE_K
```

A flat redline is not used: 1st gear must not be held to 8400 RPM. The per-gear
limit gives a progressive full-throttle feel and makes the theta = 0 and
theta = 1 rows exact. `SHIFT_CURVE_K = 1.5` keeps low-throttle shifts early
while high-throttle shifts rise steeply.

Upshift table (RPM):

|      theta      | 1->2  | 2->3  | 3->4  | 4->5  | 5->6  |
| :-------------: | :---: | :---: | :---: | :---: | :---: |
| **0%** (coast)  | 1800  | 2000  | 2200  | 2400  | 2600  |
|     **10%**     | 1870  | 2079  | 2289  | 2498  | 2708  |
|     **25%**     | 2075  | 2312  | 2550  | 2788  | 3025  |
|     **50%**     | 2578  | 2884  | 3190  | 3496  | 3802  |
|     **75%**     | 3229  | 3624  | 4019  | 4414  | 4808  |
| **100%** (full) | 4000  | 4500  | 5000  | 5500  | 6000  |

**Downshift**

The downshift threshold is the engine RPM at which the **current (higher)**
gear is left. It must account for the gear ratio step, otherwise the car
immediately re-upshifts after the downshift and hunts:

```txt
h(theta)      = HYSTERESIS_MAX - (HYSTERESIS_MAX - HYSTERESIS_MIN) * theta
RPM_down(g, theta) = RPM_up(g - 1, theta) * GEAR_RATIO_STEP * (1 - h(theta))
```

The old-style `RPM_up(g-1) * (1 - h)` values are the **post-shift RPM in the
lower gear**, not the trigger in the current gear. The trigger is that value
multiplied by `GEAR_RATIO_STEP`. After a downshift the engine lands at
`RPM_up(g-1) * (1 - h)`, which is always below the lower gear's upshift point,
so the design never hunts for any `h > 0`.

Downshift trigger table (RPM, in the **current** gear):

|      theta      | 6->5  | 5->4  | 4->3  | 3->2  | 2->1  |
| :-------------: | :---: | :---: | :---: | :---: | :---: |
| **0%** (coast)  | 1404  | 1296  | 1188  | 1080  |  972  |
|     **10%**     | 1495  | 1380  | 1264  | 1148  | 1032  |
|     **25%**     | 1726  | 1591  | 1455  | 1320  | 1184  |
|     **50%**     | 2286  | 2102  | 1918  | 1734  | 1550  |
|     **75%**     | 3038  | 2788  | 2539  | 2290  | 2040  |
| **100%** (full) | 3974  | 3643  | 3312  | 2981  | 2650  |

For reference, the resulting post-shift RPM in the lower gear is
`RPM_up(g-1) * (1 - h)`: for 2->1 that is 1350 RPM at 0% and 3680 RPM at 100%.

**Decision per tick**

```txt
if (Gear_Stick.throttle == 2) && (antiStall):
    targetGear = 1

autoAllowed = (Gear_Stick.throttle == 2)
           && (powerState == 2)
           && (!antiStall)
           && (Gearbox.clutch_factor >= 1)
           && (Gearbox.current_gear == Gearbox.target_gear)

if autoAllowed && targetGear >= 1 && targetGear <= 6:
    g = targetGear
    desired = g

    if g < 6 && Engine.rps > RPM_up(g, theta) / RPM_PER_RPS:
        desired = g + 1
    elseif g > 1 && Engine.rps < RPM_down(g, theta) / RPM_PER_RPS:
        desired = g - 1

    if desired != g:
        targetGear = desired
```

**Rules / caveats**

- Auto shifting only runs in drive mode; reverse (`targetGear == -1`) and
  neutral (`targetGear == 0`) are left to the gear-stick handling.
- While `antiStall` is active in drive mode, force `targetGear = 1` and freeze
  auto decisions. Anti-stall puts the gearbox in a fake neutral, so `Engine.rps`
  no longer tracks wheel speed; when it recovers the car resumes in 1st.
- Freeze while `Gearbox.current_gear != Gearbox.target_gear` or
  `clutch_factor < 1` (a shift is in progress). The gearbox may jump several
  gears in a few ticks; the game handles the mechanical jump, so only wait for
  it to settle rather than sequencing reducer pulses.
- Decisions are re-evaluated only after the current shift completes
  (`current_gear == target_gear` and `clutch_factor >= 1`); there is no separate
  settle timer.
- All thresholds are in RPM; compare against `Engine.rps` only after dividing
  by `RPM_PER_RPS`.
- If the scripting language rejects a fractional exponent, compute
  `theta ^ 1.5` as `exp(1.5 * ln(max(theta, epsilon)))` and guard `theta = 0`.
- Flooring the pedal naturally cascades downshifts one gear per completed
  shift, so there is no separate skip-a-gear kickdown. That aggressive behavior
  is left for a future S mode if wanted.
- At a standstill in gear 1 there is nothing to downshift; the car simply stays
  in 1st until the upshift line is crossed.
- Drive-mode engagement still starts in 1st with `antiStall` set, as it does
  today; auto shifting resumes once anti-stall clears and the gearbox settles.

## Engine

### Databus Inputs (Out Variables)

- Engine.rps
  - Fractional
  - the engine starts at 6 rps (360 RPM)
- Engine.lubricant_volume
  - Fractional
  - current oil level
- Engine.lubricant_capacity
  - Fractional
  - total oil capacity
- Engine.coolant_volume
  - Fractional
  - current coolant level
- Engine.coolant_capacity
  - Fractional
  - total coolant capacity
- Engine.temperature
  - Fractional
  - engine temperature, max
- Fuel_Tank.liquid_capacity
  - Fractional
  - total fuel capacity
- Fuel_Tank.total_liquid_volume
  - Fractional
  - current fuel level
- Steering_Wheel.right_pedal
  - Fractional
  - Throttle input, 0(no Throttle) -> 1(full Throttle)
- Wheel_FL.rps / Wheel_FR.rps / Wheel_RL.rps / Wheel_RR.rps
  - Fractional
  - wheel speeds, used only by traction control
  - FL/FR are driven, RL/RR are the un-driven ground-speed reference
- Btn_TC.is_pressed
  - Boolean
  - traction control button, toggles TC on/off

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
- Btn_TC.is_illuminated
  - Boolean
  - on when TC is disabled or actively cutting, off otherwise
- Dial_Coolant.display_value
  - Fractional
  - coolant percentage, 0-1, map to -1 - 1
- Dial_Coolant.is_illuminated
  - Boolean
  - on when powerState > 0, or blinks when warning(less than 0.25)
- Dial_Oil.display_value
  - Fractional
  - oil percentage, 0-1, map to -1 - 1
- Dial_Oil.is_illuminated
  - Boolean
  - on when powerState > 0, or blinks when warning(less than 0.25)
- Dial_Temp.display_value
  - Fractional
  - engine temp, 60-120,map to -1 - 1
- Dial_Temp.is_illuminated
  - Boolean
  - on when powerState > 0, or blinks when warning(>100)
- Dial_Fuel.display_value
  - Fractional
  - oil percentage, 0-1, map to -1 - 1
- Dial_Fuel.is_illuminated
  - Boolean
  - on when powerState > 0, or blinks when warning(less than 0.1)

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
    2. apply pedal input (skipped while `antiStall` is active or while traction
       control is cutting):
        - `engineThrottle = minimalThrottle + (1.0 - minimalThrottle) * pedalInput`
        - clamp `engineThrottle` to `[MIN_IDLE_THROTTLE, 1.0]`
        - when traction control is cutting this tick the pedal term is omitted,
          so `engineThrottle = minimalThrottle` (idle floor kept, see Traction
          Control below)
    3. set `ASM_Throttle.input` -> `engineThrottle`
- RPM dial: `Dial_RPM.display_value = dial_map(Engine.rps, 0, DIAL_RPM_MAX)`

`dial_map(input, min, max)` maps `[min, max]` to `[-1, 1]` and clamps the result
to `[-1, 1]`.

### Traction Control

FWD traction control, evaluated inside `engine_on_tick`. The rear wheels are
un-driven, so rear speed is the ground-speed reference; the driven front wheels
can spin faster than the car is actually moving. When they do, the driver's
pedal contribution is removed from the throttle output.

**Reference and detector**

```txt
rearAvg  = (abs(Wheel_RL.rps) + abs(Wheel_RR.rps)) * 0.5
frontAvg = (abs(Wheel_FL.rps) + abs(Wheel_FR.rps)) * 0.5
```

- `abs` per wheel: wheel rps is signed in reverse, so a raw average would give a
  negative baseline and never trigger.
- No division by `rearAvg`: use a ratio plus an absolute offset. The rear
  baseline is only trusted once `rearAvg > TRACTION_MIN_REF_RPS`.

**Constants**

```txt
TRACTION_SLIP_RATIO     = 1.20   # front/rear speed ratio to start cutting
TRACTION_SLIP_OFFSET    = 0.3    # rps, absolute slip margin
TRACTION_MIN_PEDAL      = 0.1    # only active while throttle is applied
TRACTION_MIN_REF_RPS    = 0.5    # rear must roll before it is trusted
```

**Global state**

```txt
tcEnabled       # latching, default true
lastTCPressed   # TC button edge detector
```

**Button handling**

Same latching pattern as the ABS button:

- on the rising edge of `Btn_TC.is_pressed`, toggle `tcEnabled`
- a held button does not repeat
- default on; the state is not reset on power off
- always update `lastTCPressed` each tick

**Detector per tick**

Stateless: recompute slip every tick, no latch.

```txt
slipThreshold = rearAvg * TRACTION_SLIP_RATIO + TRACTION_SLIP_OFFSET
slip = (rearAvg > TRACTION_MIN_REF_RPS) && (frontAvg > slipThreshold)
```

Eligibility gate; the throttle is only cut while all of these hold:

```txt
powerState == 2
targetGear != 0
! antiStall
tcEnabled
Steering_Wheel.right_pedal > TRACTION_MIN_PEDAL
all four wheel-rps databus variables available
```

**Throttle cut**

When `slip` is true, skip the pedal-blend term in the Engine throttle logic and
use the clamped idle/anti-stall throttle:

```txt
engineThrottle = minimalThrottle                              # traction cut
engineThrottle = minimalThrottle
               + (1.0 - minimalThrottle) * pedalInput         # normal
```

The result is clamped to `[MIN_IDLE_THROTTLE, 1.0]` as before. The idle floor is
intentionally kept: writing `0` would fight the idle controller and stall the
engine. Recovery is immediate on the next tick `frontAvg` is under the threshold.

**Button light**

```txt
Btn_TC.is_illuminated = (! tcEnabled) || slip
```

- on when TC is disabled
- on while TC is actively cutting this tick
- off otherwise

**Validation / caveats**

- The rear-baseline idea is correct: on a FWD car the rear axle is the only
  un-driven speed source, so it is the right reference.
- TC does not operate from a standstill: while `rearAvg <= TRACTION_MIN_REF_RPS`
  the rear baseline is not trusted, so launch wheelspin is left uncontrolled.
- The rolling gate only covers a non-rolling/unloaded rear axle. If the rear
  wheels are still rolling while the fronts are off the ground, the fronts can
  still trigger a cut; a ground-contact or body-speed input is the exact fix.
- Cornering changes path length. At full lock the front-axle average travels
  about 16% farther than the rear-axle average, and the outer front travels
  about 30% farther than the rear average. The ratio + offset tolerates this at
  low speed; at speed the steering angle is smaller, so the ratio approaches 1.
  Verify at full-lock low speed and raise `TRACTION_SLIP_RATIO` if it
  false-triggers.
- Averaging both front wheels partially masks a single spinning wheel on an open
  differential; strong single-wheel spin still crosses the threshold. If it
  under-detects, compare each front wheel (or `max` front), which also increases
  cornering false positives.
- Requiring all four wheel variables prevents a missing rear databus from
  leaving `rearAvg == 0` and producing a false cut.
- The `antiStall` gate avoids acting while the transmission holds the gearbox in
  its fake neutral, where the front wheels are not being driven.
- The detector is stateless, so a front speed hovering at the threshold can
  chatter the throttle; add a latch or recover threshold only if that shows up
  in testing.
- Cutting torque can drop `Engine.rps` below `ANTI_STALL_RPS`; the existing
  transmission anti-stall then takes over (fake neutral). This is acceptable.

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
- `MAX_BRAKE_PRESSURE = 0.5`
  - final scale applied to every wheel's brake pressure output
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
- final scale: every wheel output is multiplied by `MAX_BRAKE_PRESSURE`
- so `FL = frontBase * absFactorFL * MAX_BRAKE_PRESSURE`,
  `FR = frontBase * absFactorFR * MAX_BRAKE_PRESSURE`,
  `RL = rearBase * absFactorRL * MAX_BRAKE_PRESSURE`,
  `RR = rearBase * absFactorRR * MAX_BRAKE_PRESSURE`
- no clamping is needed: the pedal is in `[0, 1]`, `REAR_BRAKE_RATIO < 1`,
  `MAX_BRAKE_PRESSURE < 1`, and each ABS factor is in `[0, 1]`

Base combinations (before ABS modulation and `MAX_BRAKE_PRESSURE`):

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

