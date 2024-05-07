const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mariadb = require("mariadb");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const authController = require("./controllers/auth");

dotenv.config({ path: "./.env" });
const pool = require("./model/db"); // Database connection pool
const app = express();

app.set("view engine", "ejs");

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use(express.json());
app.use(cookieParser());

// MariaDB CONNECTION-----------------------------------------------------------

pool
  .getConnection()
  .then((conn) => {
    console.log("Connected to MariaDB!");
    conn.release(); // Release the connection when done
  })
  .catch((err) => {
    console.error("Error connecting to MariaDB:", err);
    throw err;
  });

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Internal Server Error");
});

//Some GLOBAL VARIABLES====================================================
let pincode;
let hospital;
let vaccine;

async function fetchPincode() {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query("SELECT pincode FROM location");
    return rows; // Return fetched pincode data
  } catch (err) {
    throw err;
  } finally {
    conn.release();
  }
}

async function fetchHospital() {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query("SELECT H_name, H_address FROM hosp_data");
    return rows;
  } catch (err) {
    throw err;
  } finally {
    conn.release(); // release connection in the end
  }
}

async function fetchVaccine() {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query("SELECT V_name from vaccine");
    return rows; // Assign fetched rows to vaccine variable
  } catch (err) {
    throw err;
  } finally {
    conn.release(); // release connection in the end
  }
}

async function fetchData() {
  try {
    await fetchPincode();
    await fetchHospital();
    await fetchVaccine();
  } catch (err) {
    throw err;
  }
}
/*****************************GET REQUESTS****************************/
/*********************************************************************/

//

app.get("/", async (req, res) => {
  try {
    let sql =
      "select ( select count(*) from vaccinates) as count_vacc, ( select count(*) from hosp_data) as count_hosp, ( select count(*) from inventory) as count_invent from dual;";
    let sqla =
      "SELECT count(*) as count_,h.H_vac from vaccinates as v INNER JOIN hosp_data as h WHERE v.Hosp=h.H_id GROUP By h.H_vac";
    const conn = await pool.getConnection();
    const [counts, vaccineResult] = await Promise.all([
      conn.query(sql),
      conn.query(sqla),
    ]);
    conn.release();

    res.render("home", { count: counts[0], vaccine: vaccineResult });
  } catch (err) {
    throw err;
  }
});



// Stat page get request---------------------------------------------------
app.get("/stat", async (req, res) => {
  try {
    let sql =
      "SELECT count(P_Gender) as count, ((count(P_Gender)*100)/(select count(*) from person)) as percentage, P_Gender FROM person GROUP By P_Gender";
    let sqli =
      "SELECT count(*) as count ,((count(H_type)*100)/(select count(*) from vacc_data)) as percentage,H_type FROM vacc_data GROUP By H_type;";
    let sqla =
      "SELECT count(*) as count ,((count(h_type)*100)/(select count(*) from hosp_data)) as percentage,H_type FROM hosp_data GROUP By h_type;";
    let sqlii =
      "select h_vac, count(*) as count, ((count(h_vac)*100)/(select count(*) from vacc_data)) as percentage from vacc_data group by h_vac;";
    let sqlb =
      "select (select count(*) from vaccinates where Date_first is not NULL and Date_second IS NULL) as onedose, (select count(*) from vaccinates where Date_first is not NULL and Date_second is not null) as twodose, (select count(*) from vaccinates where Date_first IS NULL and Date_second IS NULL) as nodose from dual;";
    let type2, type, vacc, dose;

    const conn = await pool.getConnection();
    const [result1, result2, result3, result4, result5] = await Promise.all([
      conn.query(sql),
      conn.query(sqli),
      conn.query(sqla),
      conn.query(sqlii),
      conn.query(sqlb),
    ]);
    conn.release();

    type = result2;
    type2 = result3;
    vacc = result4;
    dose = result5[0];

    res.render("stat", {
      gender: result1,
      type: type,
      type2: type2,
      vacc: vacc,
      dose: dose,
    });
  } catch (err) {
    throw err;
  }
});

// Patient form get request---------------------------------------------------
app.get("/patient", async (req, res) => {
  try {
    const [pincodeResults, hospitalResults] = await Promise.all([
      pool.query("SELECT pincode FROM location"),
      pool.query("SELECT H_name, H_address FROM hosp_data"),
    ]);

    const pincode = pincodeResults;
    const hospital = hospitalResults;

    res.render("patient", { pincodes: pincode, hospital: hospital });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving data");
  }
});

// Choose hospital during patient registration-----------------------------------------
app.get("/choose_hosp/:pin/:pid", async (req, res) => {
  try {
    const [priorityResult, hospitalResult] = await Promise.all([
      pool.query("SELECT check_priority(P_DOB) AS priority FROM person WHERE P_id = ?", [req.params.pid]),
      pool.query("SELECT * FROM hosp_data WHERE h_address = ?", [req.params.pin]),
    ]);

    const pri = priorityResult[0].priority;
    const hospital = hospitalResult;

    res.render("choose_hosp", {
      hospital: hospital,
      myid: req.params.pid,
      pri: pri,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving data");
  }
});


// Hospital form get request---------------------------------------------------
app.get("/Registerhospital", async (req, res) => {
  try {
    const [pincodeResults, vaccineResult] = await Promise.all([
      fetchPincode(), // Fetch pincode data

      new Promise((resolve, reject) => {
        pool.query("SELECT V_name from vaccine", (err, result) => {
          if (err) reject(err);
          resolve(result);
        });
      }),
    ]);

      res.render("Registerhospital", {
      pincodes: pincodeResults, // Pass fetched pincode data to the view
      message: "Enter details to Register",
      color: "success",
      vaccines: vaccineResult
    });
  } catch (err) {
    throw err;
  }
});

// Inventory form get request---------------------------------------------------
app.get("/Registerinventory", async (req, res) => {
  try {
    const pincodes = await fetchPincode(); // Fetch pincode data

    console.log("Fetched pincode data (Inventory):"); // Log fetched pincode data

    if (!pincodes || pincodes.length === 0) {
      console.log("No pincodes available"); // Log if pincodes array is empty or undefined
    }
    res.render("Registerinventory", { pincodes: pincodes }); // Pass pincode data to template rendering
  } catch (err) {
    throw err;
  }
});

// Inventory data from profile-----------------------------------------------------
app.get("/inventory_data", authController.isLoggedIn, async (req, res) => {
  try {
    if (req.user) {
      const inventDetails = await new Promise((resolve, reject) => {
        let sql =
          "select i.*, s.s_time,s.s_quantity,s_id from inventory i join supplies s on s_inventory = i.i_id join hosp_data h on h.h_id = s.s_hospital where h.h_id = ? order by s.s_time desc;";
        pool.query(sql, req.user.H_id, (err, result) => {
          if (err) reject(err);
          resolve(result);
        });
      });

      const costDetails = await new Promise((resolve, reject) => {
        let sql2 =
          "select case when h.h_type = 'P' then v.v_cost*s.s_quantity when h.h_type = 'G' then 0 end as total_cost from hosp_data h join vaccine v on v.v_name = h.h_vac join supplies s on s.s_hospital = h.h_id where h.h_id = ? order by s.s_time desc;";
        pool.query(sql2, req.user.H_id, (err, result) => {
          if (err) reject(err);
          resolve(result);
        });
      });

      const quantRem = await new Promise((resolve, reject) => {
        let sql3 = "select quant_rem from hospital where h_id = ?;";
        pool.query(sql3, req.user.H_id, (err, result) => {
          if (err) reject(err);
          resolve(result[0].quant_rem);
        });
      });

      res.render("inventory_data", {
        inventory: inventDetails,
        cost: costDetails,
        check: 0,
        quant_rem: quantRem,
      });
    } else {
      res.render("hosp_login", { message: "" });
    }
  } catch (err) {
    throw err;
  }
});

// Login into profile if cookie exists---------------------------------------------------------
app.get("/hospitaldata", authController.isLoggedIn, async (req, res) => {
  try {
    console.log("inside");
    console.log(req.user);
    if (req.user) {
      const countResult = await new Promise((resolve, reject) => {
        let sql1 =
          "select count(*) as count from vaccinates where hosp = ? and date_first is not null;";
        pool.query(sql1, req.user.H_id, (err, result) => {
          if (err) reject(err);
          resolve(result[0].count);
        });
      });

      const inventDetails = await new Promise((resolve, reject) => {
        let sql =
          "select i.*, s.s_time,s.s_quantity from inventory i join supplies s on s_inventory = i.i_id join hosp_data h on h.h_id = s.s_hospital where h.h_id = ? order by s.s_time desc;";
        pool.query(sql, req.user.H_id, (err, result) => {
          if (err) reject(err);
          resolve(result[0]);
        });
      });

      const invResult = await new Promise((resolve, reject) => {
        let sql2 = "select * from inventory;";
        pool.query(sql2, req.user.H_id, (err, result) => {
          if (err) reject(err);
          resolve(result);
        });
      });

      const inv = invResult[0].inv;

      res.render("hospitaldata", {
        user: req.user,
        invent_details: inventDetails,
        count: countResult,
        inv: invResult,
      });
    } else {
      res.render("hosp_login", { message: "" });
    }
  } catch (err) {
    throw err;
  }
});

// LOGOUT request---------------------------------------------------
app.get("/logout", authController.logout);
app.get("/hosp_login", (req, res) => {
  res.render("hosp_login", { message: "" });
});

// Hospital patient data page request---------------------------------------------------

app.get("/hosp_logindata", authController.isLoggedIn, async (req, res) => {
  try {
    if (req.user) {
      const result = await new Promise((resolve, reject) => {
        let sql1 = "call filter_patients(4, ?);";
        pool.query(sql1, req.user.H_id, (err, result) => {
          if (err) reject(err);
          resolve(result);
        });
      });

      res.render("hosp_logindata", {
        user: req.user,
        patient_details: result,
        message: "All records",
        check: 0,
      });
    } else {
      res.render("hosp_login", { message: "" });
    }
  } catch (err) {
    throw err;
  }
});

// ONE DOSE in patient page in hospital profile request---------------------------------------------------
app.get("/onedose", authController.isLoggedIn, (req, res) => {
  if (req.user) {
    let sql1 = "call filter_patients(1, ?);";
    pool.query(sql1, req.user.H_id, function (err, result) {
      if (err) {
        if (
          err.code === "ER_WRONG_VALUE" &&
          err.sqlMessage.includes("'0000-00-00'")
        ) {
          // Handle the case where the date value is '0000-00-00'
          res.render("hosp_logindata", {
            user: req.user,
            patient_details: result,
            message: "One dose administered",
            check: 0,
          });
        } else {
          throw err;
        }
      } else {
        res.render("hosp_logindata", {
          user: req.user,
          patient_details: result,
          message: "One dose administered",
          check: 0,
        });
      }
    });
  } else {
    res.render("hosp_login", {
      message: "",
    });
  }
});

// NO DOSE in patient page in hospital profile request---------------------------------------------------
app.get("/nodose", authController.isLoggedIn, (req, res) => {
  if (req.user) {
    let sql1 = "call filter_patients(3, ?);";
    pool.query(sql1, req.user.H_id, function (err, result) {
      if (err) throw err;
      res.render("hosp_logindata", {
        user: req.user,
        patient_details: result,
        message: "No dose administered",
        check: 0,
      });
    });
  } else {
    res.render("hosp_login", {
      message: "",
    });
  }
});

// BOTH DOSE in patient page in hospital profile request---------------------------------------------------
app.get("/bothdose", authController.isLoggedIn, (req, res) => {
  if (req.user) {
    let sql1 = "call filter_patients(2, ?);";
    pool.query(sql1, req.user.H_id, function (err, result) {
      if (err) {
        if (err.code === "ER_WRONG_VALUE") {
          console.error(
            "Error: Incorrect DATE value. Handling the error gracefully."
          );
          res.render("hosp_logindata", {
            user: req.user,
            patient_details: [],
            message: "Error: Incorrect DATE value. Please check the data.",
            check: 0,
          });
        } else {
          throw err;
        }
      } else {
        res.render("hosp_logindata", {
          user: req.user,
          patient_details: result,
          message: "Both dose administered",
          check: 0,
        });
      }
    });
  } else {
    res.render("hosp_login", {
      message: "",
    });
  }
});

/************************POST REQUESTS*******************************/
/********************************************************************/

// Deletes records from supplies table from inventory page
app.post("/delete", authController.isLoggedIn, (req, res) => {
  if (req.user) {
    let sql = "DELETE FROM supplies WHERE S_id = ? AND S_hospital = ?";
    pool.query(sql, [req.body.checkbox, req.user.H_id], (err, result) => {
      if (err) throw err;
      res.redirect("/inventory_data");
    });
  } else {
    res.redirect("/");
  }
});


// Patient registration post request
// Patient registration post request
app.post("/patient", async (req, res) => {
  console.log("Received patient registration request:", req.body); // Log request body
  const { inputName, inputEmail, inputPIN, inputDOB, contact, optradio } = req.body;

  const values = [inputName, inputEmail, inputPIN, inputDOB, contact, optradio];

  const sql = "INSERT INTO person (p_name, p_email, p_address, p_dob, p_contactno, p_gender) VALUES (?, ?, ?, ?, ?, ?)";
  
  try {
    const result = await pool.execute(sql, values);
    const pid = result.insertId;
    console.log("Patient registration successful:", result);
    console.log("Number of records inserted in patient: " + result.affectedRows);

    // Redirect to the choose_hosp route with patient ID
    res.redirect(`/choose_hosp/${inputPIN}/${pid}`);
  } catch (err) {
    console.error("Error inserting patient data:", err);
    res.status(500).send("Error inserting patient data");
  }
});


// Choosing hospital during patient registration
// Choosing hospital during patient registration
// Choosing hospital during patient registration
// Choosing hospital during patient registration
  app.post("/choose_hosp/:id", async (req, res) => {
    const hosp_name = req.body.inputHOSP;
    const p_id = req.params.id;

    try {
      const [result] = await pool.query("SELECT * FROM hosp_data WHERE H_name = ?", [hosp_name]);
      
      if (result.length === 0) {
        await pool.query("DELETE FROM person WHERE p_id = ?", [p_id]);
        console.log("Deleted patient data with ID: " + p_id);
        res.status(400).send("Hospital not found");
      } else {
        const hosp_id = result[0]?.H_id; // Add the check here
        if (hosp_id) {
          const values = [p_id, hosp_id];

          const insertResult = await pool.query("INSERT INTO vaccinates (P, Hosp) VALUES (?)", [values]);
          console.log("Number of records inserted in vaccinates: " + insertResult.affectedRows);

          await pool.query("DELETE FROM person WHERE p_id = ?", [p_id]);
          console.log("Deleted patient data with ID: " + p_id);
          
          res.redirect("/"); // Redirect to homepage
        } else {
          console.error("Error: H_id is undefined");
          res.status(500).send("Error: H_id is undefined");
        }
      }
    } catch (err) {
      console.error("Error during patient registration:", err);
      res.status(500).send("Error during patient registration");
    }
  });







// Hospital signup page post request------------------------------
app.post("/Registerhospital", async (req, res) => {
  console.log(req.body);

  const name = req.body.inputName;
  const email = req.body.inputEmail;
  const contact = req.body.inputContact;
  const htype = req.body.inputhospitaltype;
  const pwd = req.body.inputPassword;
  const repwd = req.body.reinputPassword;
  const pin = req.body.inputPIN;
  const vacc = req.body.inputVACC;

  try {
    const [pincodeResults, vaccineResult] = await Promise.all([
      fetchPincode(), // Fetch pincode data
      new Promise((resolve, reject) => {
        pool.query("SELECT V_name from vaccine", (err, result) => {
          if (err) reject(err);
          resolve(result);
        });
      }),
    ]);

    if (pincodeResults.length === 0 || !pincodeResults) {
      console.log("No pincodes available"); // Log if pincodes array is empty or undefined
      // Handle this case gracefully, maybe redirect to an error page or render a different form
    }

    if (results.length > 0) {
      return res.render("Registerhospital", {
        pincodes: pincodeResults,
        message:
          "Please Note That: That email has already been registered! Kindly head over to the login page",
        color: "danger",
        vaccines: vaccineResult,
      });
    } else if (pwd !== repwd) {
      return res.render("Registerhospital", {
        pincodes: pincodeResults,
        message: "Please Note That: Passwords do not match!",
        color: "danger",
        vaccines: vaccineResult,
      });
    }

    let hashedPassword = await bcrypt.hash(pwd, 8);
    console.log(hashedPassword);

    pool.query(
      "INSERT INTO hospital (h_name, h_email, h_contactno, h_type, h_address, h_pwd, h_vac, quant_rem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [name, email, contact, htype, pin, hashedPassword, vacc, 0],
      function (err, result) {
        if (err) throw err;
        console.log(
          "Number of records inserted in hospital: " + result.affectedRows
        );
        return res.render("Registerhospital", {
          pincodes: pincodeResults,
          message:
            "Success! Your Hospital has been registered. Please login to continue.",
          color: "success",
          vaccines: vaccineResult,
        });
      }
    );
  } catch (err) {
    throw err;
  }
});

//Hospital login page post request-------------------------------------------------------
app.post("/hospital_login", async (req, res) => {
  try {
    console.log(req.body);
    const email = req.body.hospid;
    const pwd = req.body.hospwd;
    pool.query(
      "SELECT * FROM hospital WHERE h_email = ?",
      [email],
      async (err, results) => {
        console.log("Results :", results);

        if (results.length === 0) {
          res.status(401).render("hosp_login", {
            message: "Error: Account not found.",
          });
        } else if (!(await bcrypt.compare(pwd, results[0].h_pwd))) {
          res.status(401).render("hosp_login", {
            message: "Error: Email or password does not match.",
          });
        } else {
          const id = results[0].h_id;
          console.log("id :" + id);
          const token = jwt.sign({ id }, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN,
          });

          const expirationDate = new Date();
          expirationDate.setTime(
            expirationDate.getTime() + 24 * 60 * 60 * 1000
          ); // Set the expiration time to 24 hours from now

          const cookieOptions = {
            expires: expirationDate,
            httpOnly: true,
          };
          res.cookie("jwt", token, cookieOptions);
          res.status(200).redirect("/hospitaldata");
        }
      }
    );
  } catch (error) {
    console.log(error);
  }
});

//Post request to register inventory-------------------------------------------
app.post("/Registerinventory", (req, res) => {
  const val = [
    req.body.inputName,
    req.body.inputContact,
    req.body.PINinventory,
  ];
  let sql =
    "INSERT INTO inventory (I_name, I_contactno, I_address) VALUES (?, ?, ?)"; // Corrected SQL query
  pool.query(sql, val, function (err, result) {
    if (err) throw err;
    console.log("Number of records inserted: " + result.affectedRows);
    res.redirect("/");
  });
});

// Post request from inventory page in hospital profile
app.post("/inventory_data", authController.isLoggedIn, (req, res) => {
  if (req.user) {
    const val = [req.user.H_id, req.body.id, req.body.quantity, req.body.date];

    let sqlcheck = "SELECT I_id from inventory where I_id=?";
    pool.query(sqlcheck, [req.body.id], (err, result) => {
      if (err) throw err;
      if (result.length === 0) {
        let sql =
          "select i.*, s.s_time,s.s_quantity,s_id from inventory i join supplies s on s_inventory = i.i_id join hosp_data h on h.h_id = s.s_hospital where h.h_id = ? order by s.s_time desc;";
        let sql2 =
          "select case when h.h_type = 'P' then v.v_cost*s.s_quantity when h.h_type = 'G' then 0 end as total_cost from hosp_data h join vaccine v on v.v_name = h.h_vac join supplies s on s.s_hospital = h.h_id where h.h_id = ? order by s.s_time desc;";
        let sql3 = "select quant_rem from hospital where h_id = ?;";
        pool.query(sql, req.user.H_id, function (err, result) {
          if (err) throw err;
          const invent_details = result;
          pool.query(sql2, req.user.H_id, function (err, result) {
            if (err) throw err;
            const cost = result;
            pool.query(sql3, req.user.H_id, function (err, result) {
              if (err) throw err;
              res.render("inventory_data", {
                inventory: invent_details,
                cost: cost,
                check: 1,
                quant_rem: result[0].quant_rem,
              });
            });
          });
        });
      } else {
        let sql3 =
          "INSERT INTO supplies (S_hospital,S_inventory,S_quantity,S_time) VALUES (?)";
        pool.query(sql3, [val], function (err, result) {
          if (err) throw err;
          console.log(
            "Number of records inserted in supplies: " + result.affectedRows
          );
          res.redirect("/inventory_data");
        });
      }
    });
  } else {
    res.render("hosp_login", {
      message: "",
    });
  }
});

//Hospital after logging in can see this page for adding patient data
app.post("/hosp_logindata", authController.isLoggedIn, (req, res) => {
  if (req.user) {
    console.log(req.body);
    const dose1 = req.body.dose1 || null;
    const dose2 = req.body.dose2 || null;
    const val = [dose1, dose2, req.user.H_id, req.body.id];
    let sqlcheck = "SELECT quant_rem FROM hospital WHERE h_id=?";
    let flag;
    pool.query(sqlcheck, [req.user.H_id], (err, result) => {
      if (err) throw err;
      const quantity = result[0].quant_rem;
      if (dose1 !== "" && dose2 === "" && quantity >= 1) {
        flag = 1;
      } else if (dose1 !== "" && dose2 !== "" && quantity >= 1) {
        flag = 1;
      } else {
        flag = 0;
      }
      console.log(flag);
      if (flag === 1) {
        let sql4 =
          "UPDATE vaccinates SET Date_first = ?, Date_second = ? WHERE Hosp = ? AND P = ?";
        pool.query(sql4, val, function (err, result) {
          if (err) {
            console.error(err);
            let sql1 = "CALL filter_patients(4, ?);";
            pool.query(sql1, req.user.H_id, function (err, result) {
              if (err) throw err;
              res.render("hosp_logindata", {
                user: req.user,
                patient_details: result,
                message: "All records",
                check: 1,
              });
            });
            return;
          }
          console.log("Number of records updated: " + result.affectedRows);
          if (result.affectedRows === 0) {
            let sql1 =
              "SELECT * FROM person p JOIN vaccinates v ON v.P = p.p_id JOIN hosp_data h ON v.hosp = h.h_id WHERE h.h_id = ?";
            pool.query(sql1, req.user.H_id, function (err, result) {
              if (err) throw err;
              res.render("hosp_logindata", {
                user: req.user,
                patient_details: result,
                message: "All records",
                check: 1,
              });
            });
          } else {
            res.redirect("/hosp_logindata");
          }
        });
      } else {
        let sql1 =
          "SELECT * FROM person p JOIN vaccinates v ON v.P = p.p_id JOIN hosp_data h ON v.hosp = h.h_id WHERE h.h_id = ?";
        pool.query(sql1, req.user.H_id, function (err, result) {
          if (err) throw err;
          res.render("hosp_logindata", {
            user: req.user,
            patient_details: result,
            message: "All records",
            check: 1,
          });
        });
      }
    });
  } else {
    res.render("hosp_login", {
      message: "",
    });
  }
});

/***************************LISTEN PORT******************************/
/********************************************************************/

app.listen(3001, function () {
  console.log("Server is running on port http://localhost:3001");
});
