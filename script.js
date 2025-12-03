// -------- SLIDER --------

const slides = document.querySelectorAll('.slide');

let current = 0;

const slideInterval = 10000;

function showSlide(index) {

    slides.forEach((slide, i) => {

        slide.classList.toggle('active', i === index);

    });

}

setInterval(() => {

    current = (current + 1) % slides.length;

    showSlide(current);

}, slideInterval);

// -------- COUNTRY API --------

// Load Countries

async function loadCountries() {

    const res = await fetch("https://countriesnow.space/api/v0.1/countries/positions");

    const data = await res.json();

    const countrySelect = document.getElementById("country");

    data.data.forEach(c => {

        const opt = document.createElement("option");

        opt.value = c.name;

        opt.textContent = c.name;

        countrySelect.appendChild(opt);

    });

}

// Load States

async function loadStates(country) {

    const res = await fetch("https://countriesnow.space/api/v0.1/countries/states", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ country })

    });

    const data = await res.json();

    const countySelect = document.getElementById("county");

    countySelect.innerHTML = "<option value=''>Select County / State</option>";

    data.data.states.forEach(state => {

        const opt = document.createElement("option");

        opt.value = state.name;

        opt.textContent = state.name;

        countySelect.appendChild(opt);

    });

}

// Load Cities

async function loadCities(country, state) {

    const res = await fetch("https://countriesnow.space/api/v0.1/countries/state/cities", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ country, state })

    });

    const data = await res.json();

    const subcountySelect = document.getElementById("subcounty");

    subcountySelect.innerHTML = "<option value=''>Select City / Subcounty</option>";

    data.data.forEach(city => {

        const opt = document.createElement("option");

        opt.value = city;

        opt.textContent = city;

        subcountySelect.appendChild(opt);

    });

}

// -------- POPUP --------

function showPopup(message, color) {

    const popup = document.getElementById("popup");

    const popupText = document.getElementById("popupText");

    popupText.textContent = message;

    popupText.style.color = color;

    popup.style.display = "flex";

    document.getElementById("closePopup").onclick = () => {

        popup.style.display = "none";

    };

}

// -------- FORM LISTENERS --------

// When country changes → load states

document.getElementById("country").addEventListener("change", function() {

    loadStates(this.value);

});

// When county changes → load cities

document.getElementById("county").addEventListener("change", function() {

    const country = document.getElementById("country").value;

    loadCities(country, this.value);

});

// Load countries when page opens

loadCountries();

// -------- FORM SUBMIT HANDLER (REQUIRED WORKS HERE) --------

document.getElementById("contact-form").addEventListener("submit", function(e) {

    e.preventDefault(); // stop real submit so EmailJS can run

    const name = document.getElementById("name").value;

    const phone = document.getElementById("phone").value;

    const email = document.getElementById("email").value;

    const country = document.getElementById("country").value;

    if (!name || !phone || !email || !country) {

        showPopup("Please fill all required fields.", "red");

        return;

    }

    if (country === "Kenya") {

        showPopup("Your order has been received! We will respond shortly.", "blue");

        emailjs.send("service_71ol8ee", "template_ht3t1cn", {

            name,

            phone,

            email,

            design: document.querySelector('input[name="design"]:checked')?.value || "Not selected",

            color: document.querySelector('input[name="color"]:checked')?.value || "Not selected",

            country,

            county: document.getElementById("county").value,

            subcounty: document.getElementById("subcounty").value,

            location: document.getElementById("location").value

        });

    } else {

        showPopup("Sorry! We currently don't deliver to your country.", "red");

    }

});

  const hamburger = document.getElementById("hamburger");

  const navLinks = document.getElementById("navLinks");

  hamburger.addEventListener("click", () => {

    hamburger.classList.toggle("active");

    navLinks.classList.toggle("open");

  });

  // Highlight active link when clicked

  const links = document.querySelectorAll(".nav-links a");

  links.forEach(link => {

    link.addEventListener("click", () => {

      links.forEach(l => l.classList.remove("active"));

      link.classList.add("active");

    });

  });

const cards = document.querySelectorAll('.bouquet-card');

window.addEventListener('scroll', () => {

  cards.forEach(card => {

    const rect = card.getBoundingClientRect();

    if (rect.top < window.innerHeight - 80) {

      card.style.opacity = 1;

      card.style.transform = "translateY(0)";

    }

  });

});