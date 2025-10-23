import pandas as pd
import random
from datetime import datetime, timedelta
from faker import Faker
from geopy.distance import distance
from geopy.point import Point
import os

fake = Faker()
random.seed(42)


# Kerala district centroids (approx)

district_coords = {
    'Thiruvananthapuram': (8.5241, 76.9366),
    'Kollam': (8.8932, 76.6141),
    'Pathanamthitta': (9.2640, 76.7872),
    'Alappuzha': (9.4981, 76.3388),
    'Kottayam': (9.5916, 76.5222),
    'Idukki': (9.8490, 77.0996),
    'Ernakulam': (9.9816, 76.2999),
    'Thrissur': (10.5276, 76.2144),
    'Palakkad': (10.7867, 76.6548),
    'Malappuram': (11.0730, 76.0740),
    'Kozhikode': (11.2588, 75.7804),
    'Wayanad': (11.6854, 76.1310),
    'Kannur': (11.8745, 75.3704),
    'Kasaragod': (12.4996, 74.9869)
}


# Function: Generate random point within ~10 km of district center

def random_point_near(lat, lon, max_km=10):
    origin = Point(lat, lon)
    bearing = random.uniform(0, 360)
    dist = random.uniform(0, max_km)
    destination = distance(kilometers=dist).destination(origin, bearing)
    return round(destination.latitude, 6), round(destination.longitude, 6)


# Crime + Accident Types

crime_types = [
    "Theft", "Assault", "Domestic Violence", "Cyber Crime", "Robbery",
    "Sexual Harassment", "Fraud", "Burglary", "Drug Offense", "Murder Attempt"
]

accident_types = [
    "Minor Collision", "Major Collision", "Hit and Run", "Pedestrian Hit",
    "Vehicle Overturn", "Side Swipe", "Rear-End Collision"
]


# Time Range

start_date = datetime(2022, 1, 1)
end_date = datetime(2023, 12, 31)


# Generate Crime Data

crime_rows = []
for i in range(1000):
    district = random.choice(list(district_coords.keys()))
    lat, lon = random_point_near(*district_coords[district])
    ctype = random.choice(crime_types)
    date = start_date + timedelta(days=random.randint(0, 730), hours=random.randint(0, 23))
    severity = random.randint(1, 5)
    desc = f"{ctype} reported in {district} ({fake.street_name()})"
    crime_rows.append({
        "id": f"C{i+1:04d}",
        "date": date.isoformat(),
        "latitude": lat,
        "longitude": lon,
        "district": district,
        "type": ctype,
        "severity": severity,
        "description": desc,
        "source": "Mock Kerala 2022–2023"
    })


# Generate Accident Data

acc_rows = []
for i in range(1000):
    district = random.choice(list(district_coords.keys()))
    lat, lon = random_point_near(*district_coords[district])
    atype = random.choice(accident_types)
    date = start_date + timedelta(days=random.randint(0, 730), hours=random.randint(0, 23))
    severity = random.randint(1, 5)
    vehicles = random.randint(1, 4)
    fatalities = random.choice([0, 0, 1, 2])
    desc = f"{atype} near {fake.street_name()} in {district}"
    acc_rows.append({
        "id": f"A{i+1:04d}",
        "date": date.isoformat(),
        "latitude": lat,
        "longitude": lon,
        "district": district,
        "type": atype,
        "severity": severity,
        "vehicles_involved": vehicles,
        "fatalities": fatalities,
        "description": desc,
        "source": "Mock Kerala 2022–2023"
    })


# Save to CSV files

os.makedirs("data", exist_ok=True)
crime_path = "data/kerala_crime_2022_2023.csv"
acc_path = "data/kerala_accidents_2022_2023.csv"

pd.DataFrame(crime_rows).to_csv(crime_path, index=False)
pd.DataFrame(acc_rows).to_csv(acc_path, index=False)

print(f"✅ Generated {len(crime_rows)} crime records → {crime_path}")
print(f"✅ Generated {len(acc_rows)} accident records → {acc_path}")